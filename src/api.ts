import * as auth from "./auth";
import * as core from "./core";
import { execute, now, queryOne } from "./db";
import { isLatin, searchBooks } from "./ol";
import * as ratelimit from "./ratelimit";
import * as twofa from "./twofa";

const SESSION_COOKIE = "session";
const SESSION_TTL = 60 * 60 * 24 * 30;

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return null;
}

async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const cloudflare = req.headers.get("cf-connecting-ip");
  if (cloudflare) return cloudflare;
  return "unknown";
}

async function sessionUser(db: D1Database, req: Request): Promise<core.User | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const id = await auth.getUserIdByToken(db, token);
  return id ? await core.getUserById(db, id) : null;
}

async function bearerUser(db: D1Database, req: Request): Promise<core.User | null> {
  const h = req.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("bearer ")) return null;
  const token = h.slice(7).trim();
  const row = await queryOne<{ id: number }>(db, "SELECT id FROM users WHERE api_token = ?", token);
  return row ? await core.getUserById(db, row.id) : null;
}

function setSessionCookie(token: string, req: Request): string {
  const host = req.headers.get("host") || "localhost";
  const protocol = req.headers.get("x-forwarded-proto") || "http";
  const isSecure = protocol === "https" || host.includes("bookrecs.dev") || host.includes(".pages.dev");

  // SameSite=None requires Secure; browsers reject it over plain http (local dev).
  // Use Lax locally — same-origin requests still send the cookie.
  const sameSite = isSecure ? "SameSite=None; Secure; " : "SameSite=Lax; ";
  const domain = host.includes("bookrecs.dev") ? "; Domain=bookrecs.dev" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; ${sameSite}Path=/${domain}; Max-Age=${SESSION_TTL}`;
}

function validUsername(u: unknown): u is string {
  return typeof u === "string" && /^[a-zA-Z0-9_]{3,32}$/.test(u);
}
function validEmail(e: unknown): e is string {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function validPassword(p: unknown): p is string {
  return typeof p === "string" && p.length >= 8;
}

async function handleSignup(
  db: D1Database,
  username: unknown,
  email: unknown,
  password: unknown,
  req: Request,
): Promise<Response> {
  if (!validUsername(username))
    return json({ error: "Username must be 3-32 chars (letters, numbers, underscore)" }, 400);
  if (!validEmail(email)) return json({ error: "Enter a valid email address" }, 400);
  if (!validPassword(password)) return json({ error: "Password must be at least 8 characters" }, 400);
  if (await core.usernameExists(db, username)) return json({ error: "That username is taken" }, 409);
  if (await core.emailExists(db, email)) return json({ error: "That email is already registered" }, 409);

  const hash = await auth.hashPassword(password);
  const user = await core.createUser(db, username, email, hash);

  // Notify admins of new user signup (with user ID for approve/reject)
  const admins = await core.getAdminUsers(db);
  for (const admin of admins) {
    await core.createNotification(
      db,
      admin.id,
      "new_user_signup",
      `New user signed up: ${user.username} (${user.email})`,
      { id: user.id, username: user.username, email: user.email },
    );
  }

  const token = await auth.createSession(db, user.id);
  return json(
    {
      user: {
        ...user,
        bookLimit: user.book_limit === 0 ? null : user.book_limit,
      },
    },
    200,
    { "set-cookie": setSessionCookie(token, req) },
  );
}

async function handleLogin(
  db: D1Database,
  usernameOrEmail: unknown,
  password: unknown,
  req: Request,
): Promise<Response> {
  if (typeof usernameOrEmail !== "string" || !usernameOrEmail.trim() || typeof password !== "string" || !password) {
    return json({ error: "Username/email and password are required" }, 400);
  }

  const ip = getClientIp(req);
  const identifier = usernameOrEmail.trim();

  if (await ratelimit.isBlocked(db, ip, identifier)) {
    return json({ error: "Too many failed login attempts. Please try again in 15 minutes." }, 429);
  }

  const u = await core.findUser(db, usernameOrEmail.trim());
  if (!u) {
    await ratelimit.recordFailedAttempt(db, ip, identifier);
    return json({ error: "Invalid credentials" }, 401);
  }

  const ok = await auth.verifyPassword(password, u.password_hash);
  if (!ok) {
    await ratelimit.recordFailedAttempt(db, ip, identifier);
    return json({ error: "Invalid credentials" }, 401);
  }

  if (await twofa.has2FAEnabled(db, u.id)) {
    const pendingToken = auth.randomToken(24);
    await execute(
      db,
      "INSERT INTO pending_logins (token, user_id, expires_at) VALUES (?, ?, ?)",
      pendingToken,
      u.id,
      now() + 300,
    );
    return json({ requires2FA: true, pendingToken });
  }

  await ratelimit.clearAttempts(db, ip, identifier);

  const token = await auth.createSession(db, u.id);
  return json({ user: { id: u.id, username: u.username, email: u.email, is_admin: u.is_admin } }, 200, {
    "set-cookie": setSessionCookie(token, req),
  });
}

export async function handleApi(db: D1Database, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // ----- auth -----
  if (path === "/api/signup" && method === "POST") {
    const { username, email, password } = await readBody(req);
    return handleSignup(db, username, email, password, req);
  }
  if (path === "/api/login" && method === "POST") {
    const { usernameOrEmail, password } = await readBody(req);
    return handleLogin(db, usernameOrEmail, password, req);
  }
  if (path === "/api/logout" && method === "POST") {
    const token = getCookie(req, SESSION_COOKIE);
    if (token) await auth.deleteSession(db, token);
    return json({ ok: true });
  }
  if (path === "/api/me" && method === "GET") {
    const user = (await sessionUser(db, req)) ?? (await bearerUser(db, req));
    if (user) {
      return json({
        user: {
          ...user,
          bookLimit: user.book_limit === 0 ? null : user.book_limit, // null = unlimited
          discoverable: Boolean(user.discoverable),
        },
      });
    }
    return json({ user: null });
  }
  if (path === "/api/me/privacy" && method === "GET") {
    const user = (await sessionUser(db, req)) ?? (await bearerUser(db, req));
    if (!user) return json({ error: "Unauthorized" }, 401);
    return json({ discoverable: await core.getDiscoverable(db, user.id) });
  }
  if (path === "/api/me/privacy" && method === "POST") {
    const user = (await sessionUser(db, req)) ?? (await bearerUser(db, req));
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { discoverable } = await readBody(req);
    await core.setDiscoverable(db, user.id, !!discoverable);
    return json({ ok: true, discoverable: !!discoverable });
  }
  if (path === "/api/token" && method === "POST") {
    const user = (await sessionUser(db, req)) ?? (await bearerUser(db, req));
    if (!user) return json({ error: "Unauthorized" }, 401);
    const token = auth.randomToken(24);
    await execute(db, "UPDATE users SET api_token = ? WHERE id = ?", token, user.id);
    return json({ token });
  }

  // ----- 2FA setup -----
  if (path === "/api/2fa/setup" && method === "POST") {
    const user = (await sessionUser(db, req)) ?? (await bearerUser(db, req));
    if (!user) return json({ error: "Unauthorized" }, 401);

    const secret = twofa.generateSecret();
    const uri = twofa.generateTOTPUri(user.username, secret);
    await execute(db, 'UPDATE users SET "2fa_secret" = ? WHERE id = ?', secret, user.id);
    return json({ secret, uri });
  }

  if (path === "/api/2fa/verify" && method === "POST") {
    const user = (await sessionUser(db, req)) ?? (await bearerUser(db, req));
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { token } = await readBody(req);
    if (!token) return json({ error: "Token required" }, 400);

    const secret = await twofa.get2FASecret(db, user.id);
    if (!secret) return json({ error: "No 2FA setup in progress" }, 400);

    const valid = await twofa.verifyTOTP(user.username, secret, token);
    if (!valid) return json({ error: "Invalid token" }, 400);

    await twofa.enable2FA(db, user.id, secret);
    return json({ ok: true });
  }

  if (path === "/api/2fa/disable" && method === "POST") {
    const user = (await sessionUser(db, req)) ?? (await bearerUser(db, req));
    if (!user) return json({ error: "Unauthorized" }, 401);
    await twofa.disable2FA(db, user.id);
    return json({ ok: true });
  }

  if (path === "/api/2fa/status" && method === "GET") {
    const user = (await sessionUser(db, req)) ?? (await bearerUser(db, req));
    if (!user) return json({ error: "Unauthorized" }, 401);
    return json(await twofa.get2FAStatus(db, user.id));
  }

  if (path === "/api/2fa/login" && method === "POST") {
    const { pendingToken, totpToken } = await readBody(req);
    if (!pendingToken || !totpToken) {
      return json({ error: "pendingToken and totpToken required" }, 400);
    }

    const pending = await queryOne<{ user_id: number; expires_at: number }>(
      db,
      "SELECT user_id, expires_at FROM pending_logins WHERE token = ?",
      pendingToken,
    );

    if (!pending || pending.expires_at < now()) {
      if (pending) {
        await execute(db, "DELETE FROM pending_logins WHERE token = ?", pendingToken);
      }
      return json({ error: "Invalid or expired pending token" }, 400);
    }

    const user = await core.getUserById(db, pending.user_id);
    if (!user) return json({ error: "User not found" }, 404);

    const secret = await twofa.get2FASecret(db, pending.user_id);
    if (!secret) return json({ error: "2FA not configured" }, 400);

    const valid = await twofa.verifyTOTP(user.username, secret, totpToken);
    if (!valid) return json({ error: "Invalid 2FA token" }, 400);

    await execute(db, "DELETE FROM pending_logins WHERE token = ?", pendingToken);

    const token = await auth.createSession(db, user.id);
    return json({ user: { id: user.id, username: user.username, email: user.email } }, 200, {
      "set-cookie": setSessionCookie(token, req),
    });
  }

  const user = (await sessionUser(db, req)) ?? (await bearerUser(db, req));
  if (!user) return json({ error: "Unauthorized" }, 401);

  // ----- book search & add -----
  if (path === "/api/books/search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return json({ results: [] });
    // mine=1 (club nomination search) also surfaces the user's own books
    // from their reading/wishlist/read lists, ahead of Open Library hits.
    const includeMine = url.searchParams.get("mine") === "1";
    const mine = includeMine ? await core.searchMyBooks(db, user.id, q) : [];
    const mineKeys = new Set(mine.map((m) => m.key));
    // Manual books have synthetic keys, so also dedupe Open Library hits by
    // normalized title to avoid showing the same book twice.
    const normTitle = (t: string) =>
      t
        .toLowerCase()
        .replace(/^(the|a|an)\s+/, "")
        .replace(/\s+/g, " ")
        .trim();
    const mineTitles = new Set(mine.map((m) => normTitle(m.title)));
    const mineResults = mine.map((m) => ({
      key: m.key,
      title: m.title,
      author: m.author,
      coverUrl: m.coverUrl,
      year: m.year,
      bookId: m.bookId,
      added: true,
      mine: m.list,
    }));
    try {
      const results = await searchBooks(q);
      const keys = results.map((r) => r.key);
      const existingKeys = await core.getExistingBookKeys(db, keys);
      // Books already in the system surface near the top (with the "added"
      // flag), but that boost must never override language preference: for a
      // Latin-script query, a foreign-script title ranks below every
      // Latin-script one even if it's already in the system. Buckets:
      // 0 = Latin + added, 1 = Latin + new, 2 = foreign + added, 3 = foreign + new.
      const rank = (r: { key: string; title: string }) =>
        (isLatin(q) && !isLatin(r.title) ? 2 : 0) + (existingKeys.has(r.key) ? 0 : 1);
      const sorted = results.sort((a, b) => rank(a) - rank(b));
      const resultsWithFlag = sorted
        .filter((r) => !mineKeys.has(r.key) && !mineTitles.has(normTitle(r.title)))
        .map((r) => ({ ...r, added: existingKeys.has(r.key) }));
      return json({ results: [...mineResults, ...resultsWithFlag] });
    } catch (e) {
      // Open Library is down, but the user's own matches are still useful.
      if (mineResults.length > 0) return json({ results: mineResults });
      return json({ error: "Open Library is unavailable right now", detail: String(e) }, 502);
    }
  }

  const bookDetailMatch = path.match(/^\/api\/books\/(\d+)$/);
  if (bookDetailMatch && method === "GET") {
    const bookId = Number(bookDetailMatch[1]);
    const detail = await core.getBookDetail(db, user.id, bookId);
    if (!detail) return json({ error: "Book not found" }, 404);
    return json({ book: detail });
  }

  const bookCoverMatch = path.match(/^\/api\/books\/(\d+)\/cover$/);
  if (bookCoverMatch && method === "POST") {
    const bookId = Number(bookCoverMatch[1]);
    const { cover_url } = await readBody(req);
    if (!cover_url || typeof cover_url !== "string") {
      return json({ error: "Cover URL is required" }, 400);
    }
    const updated = await core.setBookCover(db, bookId, cover_url);
    if (!updated) return json({ error: "Book not found" }, 404);
    return json({ book: updated });
  }

  if (path === "/api/books/backfill-synopses" && method === "POST") {
    try {
      const result = await core.backfillSynopses(db);
      return json(result);
    } catch (e) {
      return json({ error: "Failed to backfill synopses", detail: String(e) }, 500);
    }
  }

  if (path === "/api/books/manual" && method === "POST") {
    const { title, author, year, coverUrl, review, rank, public: isPublic } = await readBody(req);

    // Check if user has reached the book limit
    if (!(await core.canAddMoreBooks(db, user.id))) {
      const limit = await core.getUserBookLimit(db, user.id);
      return json({ error: `You have reached the maximum of ${limit} books` }, 400);
    }

    const r = await core.addManualBook(
      db,
      user.id,
      { title, author, year: year != null && year !== "" ? Number(year) : undefined, coverUrl },
      review,
      rank,
      isPublic,
    );
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: await core.listReads(db, user.id) });
  }

  if (path === "/api/books" && method === "POST") {
    const { ol_key, review, rank, year, public: isPublic } = await readBody(req);

    // Check if user has reached the book limit
    if (!(await core.canAddMoreBooks(db, user.id))) {
      const limit = await core.getUserBookLimit(db, user.id);
      return json({ error: `You have reached the maximum of ${limit} books` }, 400);
    }

    const r = await core.addRead(db, user.id, ol_key, review, rank, year, isPublic);
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: await core.listReads(db, user.id) });
  }

  if (path === "/api/me/books" && method === "GET") {
    const books = await core.listReads(db, user.id);
    const reading = await core.listReading(db, user.id);
    const readingSet = new Set(reading.map((b) => b.book_id));
    const booksWithReadingStatus = books.map((b) => ({ ...b, isReading: readingSet.has(b.book_id) }));
    const bookCount = await core.getUserReadCount(db, user.id);
    const bookLimit = await core.getUserBookLimit(db, user.id);
    return json({ books: booksWithReadingStatus, bookCount, maxBooks: bookLimit });
  }

  if (path === "/api/me/books/reorder" && method === "POST") {
    const { ordered } = await readBody(req);
    await core.reorderReads(db, user.id, Array.isArray(ordered) ? ordered.map(Number) : []);
    return json({ books: await core.listReads(db, user.id) });
  }

  const bookMatch = path.match(/^\/api\/me\/books\/(\d+)$/);
  if (bookMatch) {
    const bookId = Number(bookMatch[1]);
    if (method === "PATCH") {
      const { review, rank } = await readBody(req);
      if (rank != null) {
        const r = await core.setRank(db, user.id, bookId, Number(rank));
        if (r.error) return json({ error: r.error }, 400);
      }
      if (typeof review === "string") await core.setReview(db, user.id, bookId, review);
      return json({ books: await core.listReads(db, user.id) });
    }
    if (method === "DELETE") {
      await core.removeRead(db, user.id, bookId);
      return json({ books: await core.listReads(db, user.id) });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const readPublic = path.match(/^\/api\/me\/books\/(\d+)\/public$/);
  if (readPublic && method === "POST") {
    const { public: isPublic } = await readBody(req);
    const r = await core.setReadPublic(db, user.id, Number(readPublic[1]), !!isPublic);
    if (r.error) return json({ error: r.error }, 400);
    return json({ books: await core.listReads(db, user.id) });
  }

  // ----- wishlist -----
  if (path === "/api/me/next-up" && method === "GET") {
    return json({ books: await core.getNextUp(db, user.id) });
  }
  if (path === "/api/me/wishlist" && method === "GET") {
    return json({ books: await core.listWishlist(db, user.id) });
  }
  if (path === "/api/me/wishlist" && method === "POST") {
    const { ol_key, book_id, owned, public: isPublic, year, rank } = await readBody(req);
    if (book_id != null) {
      const r = await core.addToWishlistByBookId(db, user.id, Number(book_id), !!owned, !!isPublic, rank);
      if (r.error) return json({ error: r.error }, 400);
      return json({ book: r.book, books: await core.listWishlist(db, user.id) });
    }
    const r = await core.addToWishlistByOlKey(db, user.id, ol_key, !!owned, year, !!isPublic, rank);
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: await core.listWishlist(db, user.id) });
  }
  if (path === "/api/me/wishlist/manual" && method === "POST") {
    const { title, author, year, coverUrl, owned, public: isPublic, rank } = await readBody(req);
    const r = await core.addManualToWishlist(
      db,
      user.id,
      { title, author, year: year != null && year !== "" ? Number(year) : undefined, coverUrl },
      !!owned,
      !!isPublic,
      rank,
    );
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: await core.listWishlist(db, user.id) });
  }
  if (path === "/api/me/wishlist/reorder" && method === "POST") {
    const { ordered } = await readBody(req);
    await core.reorderWishlist(db, user.id, Array.isArray(ordered) ? ordered.map(Number) : []);
    return json({ books: await core.listWishlist(db, user.id) });
  }
  const wishPublic = path.match(/^\/api\/me\/wishlist\/(\d+)\/public$/);
  if (wishPublic && method === "POST") {
    const { public: isPublic } = await readBody(req);
    const r = await core.setWishPublic(db, user.id, Number(wishPublic[1]), !!isPublic);
    if (r.error) return json({ error: r.error }, 400);
    return json({ books: await core.listWishlist(db, user.id) });
  }
  const wishMove = path.match(/^\/api\/me\/wishlist\/(\d+)\/move-to-read$/);
  if (wishMove && method === "POST") {
    const { review, rank } = await readBody(req);
    const r = await core.moveToRead(db, user.id, Number(wishMove[1]), review, rank);
    if (r.error) return json({ error: r.error }, 400);
    return json({
      ok: true,
      books: await core.listWishlist(db, user.id),
      readBooks: await core.listReads(db, user.id),
    });
  }
  const wishOwned = path.match(/^\/api\/me\/wishlist\/(\d+)\/owned$/);
  if (wishOwned && method === "POST") {
    const { owned } = await readBody(req);
    const r = await core.setOwned(db, user.id, Number(wishOwned[1]), !!owned);
    if (r.error) return json({ error: r.error }, 400);
    return json({ books: await core.listWishlist(db, user.id) });
  }
  const wishMatch = path.match(/^\/api\/me\/wishlist\/(\d+)$/);
  if (wishMatch && method === "DELETE") {
    await core.removeFromWishlist(db, user.id, Number(wishMatch[1]));
    return json({ books: await core.listWishlist(db, user.id) });
  }

  // ----- currently reading -----
  if (path === "/api/me/reading" && method === "GET") {
    return json({ books: await core.listReading(db, user.id) });
  }
  if (path === "/api/me/reading" && method === "POST") {
    const { ol_key, book_id, year } = await readBody(req);
    if (book_id != null) {
      const r = await core.addToReadingByBookId(db, user.id, Number(book_id));
      if (r.error) return json({ error: r.error }, 400);
      return json({ book: r.book, books: await core.listReading(db, user.id) });
    }
    const r = await core.addToReadingByOlKey(db, user.id, ol_key, year);
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: await core.listReading(db, user.id) });
  }
  if (path === "/api/me/reading/from-wishlist" && method === "POST") {
    const { book_id } = await readBody(req);
    const r = await core.moveFromWishlistToReading(db, user.id, Number(book_id));
    if (r.error) return json({ error: r.error }, 400);
    return json({
      book: r.book,
      books: await core.listReading(db, user.id),
      wishBooks: await core.listWishlist(db, user.id),
    });
  }
  if (path === "/api/me/reading/manual" && method === "POST") {
    const { title, author, year, coverUrl } = await readBody(req);
    const r = await core.addManualToReading(db, user.id, {
      title,
      author,
      year: year != null && year !== "" ? Number(year) : undefined,
      coverUrl,
    });
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: await core.listReading(db, user.id) });
  }
  const readingFinish = path.match(/^\/api\/me\/reading\/(\d+)\/finish$/);
  if (readingFinish && method === "POST") {
    const { review, rank } = await readBody(req);
    const r = await core.finishReading(db, user.id, Number(readingFinish[1]), review, rank);
    if (r.error) return json({ error: r.error }, 400);
    return json({ ok: true, readBooks: await core.listReads(db, user.id) });
  }
  const readingBack = path.match(/^\/api\/me\/reading\/(\d+)\/back-to-wishlist$/);
  if (readingBack && method === "POST") {
    const r = await core.backToWishlist(db, user.id, Number(readingBack[1]));
    if (r.error) return json({ error: r.error }, 400);
    return json({
      ok: true,
      wishBooks: await core.listWishlist(db, user.id),
      books: await core.listReading(db, user.id),
    });
  }
  const readingMatch = path.match(/^\/api\/me\/reading\/(\d+)$/);
  if (readingMatch && method === "DELETE") {
    await core.removeFromReading(db, user.id, Number(readingMatch[1]));
    return json({ books: await core.listReading(db, user.id), wishBooks: await core.listWishlist(db, user.id) });
  }

  // ----- users -----
  if (path === "/api/users/search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return json({ users: [] });
    return json({ users: await core.searchUsers(db, q, user.id) });
  }
  if (path === "/api/users/discover" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q) {
      return json({ users: await core.searchUsers(db, q, user.id) });
    }
    return json({ users: await core.discoverUsers(db, user.id) });
  }

  // ----- friends -----
  if (path === "/api/friends" && method === "GET") {
    return json({ friends: await core.listFriendsWithReading(db, user.id) });
  }
  if (path === "/api/friends/requests" && method === "GET") {
    return json(await core.listFriendRequests(db, user.id));
  }
  if (path === "/api/friends/requests" && method === "POST") {
    const { usernameOrEmail } = await readBody(req);
    const r = await core.sendFriendRequest(db, user.id, usernameOrEmail);
    if (r.error) return json({ error: r.error }, 400);
    return json(r);
  }
  const requestAction = path.match(/^\/api\/friends\/requests\/(\d+)\/(accept|decline)$/);
  if (requestAction && method === "POST") {
    const id = Number(requestAction[1]);
    const r =
      requestAction[2] === "accept"
        ? await core.acceptFriendRequest(db, user.id, id)
        : await core.declineFriendRequest(db, user.id, id);
    if (r.error) return json({ error: r.error }, 404);
    return json(r);
  }
  const friendBooks = path.match(/^\/api\/friends\/([^/]+)\/books$/);
  if (friendBooks && method === "GET") {
    const r = await core.getFriendReads(db, user.id, decodeURIComponent(friendBooks[1]));
    if (r.error) return json({ error: r.error }, r.error === "User not found" ? 404 : 403);
    return json({ user: r.user, books: r.books });
  }
  const friendWish = path.match(/^\/api\/friends\/([^/]+)\/wishlist$/);
  if (friendWish && method === "GET") {
    const r = await core.getFriendWishlist(db, user.id, decodeURIComponent(friendWish[1]));
    if (r.error) return json({ error: r.error }, r.error === "User not found" ? 404 : 403);
    return json({ user: r.user, books: r.books });
  }
  const friendReading = path.match(/^\/api\/friends\/([^/]+)\/reading$/);
  if (friendReading && method === "GET") {
    const r = await core.getFriendReading(db, user.id, decodeURIComponent(friendReading[1]));
    if (r.error) return json({ error: r.error }, r.error === "User not found" ? 404 : 403);
    return json({ user: r.user, books: r.books });
  }
  // ----- change password -----
  if (path === "/api/change-password" && method === "POST") {
    const { currentPassword, newPassword } = await readBody(req);

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return json({ error: "Current and new password are required" }, 400);
    }

    if (!validPassword(newPassword)) {
      return json({ error: "New password must be at least 8 characters" }, 400);
    }

    // Verify current password
    const u = await core.findUser(db, user.email);
    if (!u) return json({ error: "User not found" }, 404);

    const valid = await auth.verifyPassword(currentPassword, u.password_hash);
    if (!valid) {
      return json({ error: "Current password is incorrect" }, 401);
    }

    // Hash and update to new password
    const newHash = await auth.hashPassword(newPassword);
    await execute(db, "UPDATE users SET password_hash = ? WHERE id = ?", newHash, user.id);

    return json({ ok: true });
  }

  const unfriend = path.match(/^\/api\/friends\/(\d+)$/);
  if (unfriend && method === "DELETE") {
    await core.removeFriend(db, user.id, Number(unfriend[1]));
    return json({ friends: await core.listFriends(db, user.id) });
  }

  // ----- clubs -----
  if (path === "/api/clubs" && method === "POST") {
    const { name, description, usernames } = await readBody(req);
    const r = await core.createClub(
      db,
      user.id,
      name,
      description,
      Array.isArray(usernames) ? usernames.map(String) : [],
    );
    if (r.error) return json({ error: r.error }, 400);
    return json({ club: r.club, invited: r.invited ?? [], skipped: r.skipped ?? [] });
  }
  if (path === "/api/clubs" && method === "GET") {
    return json(await core.listClubsForUser(db, user.id));
  }
  const clubRespond = path.match(/^\/api\/clubs\/(\d+)\/respond$/);
  if (clubRespond && method === "POST") {
    const { accept } = await readBody(req);
    const r = await core.respondToClubInvite(db, user.id, Number(clubRespond[1]), !!accept);
    if (r.error) return json({ error: r.error }, 400);
    return json({ ok: true, ...(await core.listClubsForUser(db, user.id)) });
  }
  const clubInvite = path.match(/^\/api\/clubs\/(\d+)\/invite$/);
  if (clubInvite && method === "POST") {
    const { username } = await readBody(req);
    const r = await core.inviteToClub(db, user.id, Number(clubInvite[1]), username);
    if (r.error) return json({ error: r.error }, 400);
    return json(r);
  }
  const clubNominate = path.match(/^\/api\/clubs\/(\d+)\/nominate$/);
  if (clubNominate && method === "POST") {
    const { ol_key, book_id, year } = await readBody(req);
    const r = await core.nominateBook(db, user.id, Number(clubNominate[1]), {
      olKey: ol_key,
      bookId: book_id != null ? Number(book_id) : undefined,
      year: year != null ? Number(year) : undefined,
    });
    if (r.error) return json({ error: r.error }, 400);
    return json(r);
  }
  const clubVote = path.match(/^\/api\/clubs\/(\d+)\/vote$/);
  if (clubVote && method === "POST") {
    const { nominationId } = await readBody(req);
    if (nominationId == null) return json({ error: "nominationId is required" }, 400);
    const r = await core.voteForNomination(db, user.id, Number(clubVote[1]), Number(nominationId));
    if (r.error) return json({ error: r.error }, 400);
    const detail = await core.getClub(db, user.id, Number(clubVote[1]));
    return json(detail.error ? { ok: true } : { club: detail.club });
  }
  if (clubVote && method === "DELETE") {
    const r = await core.removeVote(db, user.id, Number(clubVote[1]));
    if (r.error) return json({ error: r.error }, 400);
    const detail = await core.getClub(db, user.id, Number(clubVote[1]));
    return json(detail.error ? { ok: true } : { club: detail.club });
  }
  const clubVeto = path.match(/^\/api\/clubs\/(\d+)\/veto$/);
  if (clubVeto && method === "POST") {
    const { nominationId } = await readBody(req);
    if (nominationId == null) return json({ error: "nominationId is required" }, 400);
    const r = await core.vetoNomination(db, user.id, Number(clubVeto[1]), Number(nominationId));
    if (r.error) return json({ error: r.error }, 400);
    const detail = await core.getClub(db, user.id, Number(clubVeto[1]));
    return json(detail.error ? { ok: true } : { club: detail.club });
  }
  const clubCloseVote = path.match(/^\/api\/clubs\/(\d+)\/close-vote$/);
  if (clubCloseVote && method === "POST") {
    const r = await core.closeVote(db, user.id, Number(clubCloseVote[1]));
    if (r.error) {
      return json(
        { error: r.error, ...(r.runoffNeeded ? { runoffNeeded: true, runoffTitles: r.runoffTitles ?? [] } : {}) },
        400,
      );
    }
    return json(r);
  }
  const clubRunoff = path.match(/^\/api\/clubs\/(\d+)\/runoff$/);
  if (clubRunoff && method === "POST") {
    const r = await core.startRunoff(db, user.id, Number(clubRunoff[1]));
    if (r.error) return json({ error: r.error }, 400);
    const detail = await core.getClub(db, user.id, Number(clubRunoff[1]));
    return json(detail.error ? { ok: true } : { club: detail.club });
  }
  const clubOpenNominations = path.match(/^\/api\/clubs\/(\d+)\/open-nominations$/);
  if (clubOpenNominations && method === "POST") {
    const r = await core.openNominations(db, user.id, Number(clubOpenNominations[1]));
    if (r.error) return json({ error: r.error }, 400);
    return json(r);
  }
  const clubStartVoting = path.match(/^\/api\/clubs\/(\d+)\/start-voting$/);
  if (clubStartVoting && method === "POST") {
    const r = await core.startVoting(db, user.id, Number(clubStartVoting[1]));
    if (r.error) return json({ error: r.error }, 400);
    return json(r);
  }
  const clubBackToNominations = path.match(/^\/api\/clubs\/(\d+)\/back-to-nominations$/);
  if (clubBackToNominations && method === "POST") {
    const r = await core.backToNominations(db, user.id, Number(clubBackToNominations[1]));
    if (r.error) return json({ error: r.error }, 400);
    return json(r);
  }
  const clubRemoveMember = path.match(/^\/api\/clubs\/(\d+)\/members\/(\d+)$/);
  if (clubRemoveMember && method === "DELETE") {
    const r = await core.removeClubMember(db, user.id, Number(clubRemoveMember[1]), Number(clubRemoveMember[2]));
    if (r.error) return json({ error: r.error }, 400);
    const detail = await core.getClub(db, user.id, Number(clubRemoveMember[1]));
    return json(detail.error ? { ok: true } : { club: detail.club });
  }
  const clubRemoveNomination = path.match(/^\/api\/clubs\/(\d+)\/nominations\/(\d+)$/);
  if (clubRemoveNomination && method === "DELETE") {
    const r = await core.removeNomination(
      db,
      user.id,
      Number(clubRemoveNomination[1]),
      Number(clubRemoveNomination[2]),
    );
    if (r.error) return json({ error: r.error }, 400);
    const detail = await core.getClub(db, user.id, Number(clubRemoveNomination[1]));
    return json(detail.error ? { ok: true } : { club: detail.club });
  }
  const clubLeave = path.match(/^\/api\/clubs\/(\d+)\/leave$/);
  if (clubLeave && method === "POST") {
    const r = await core.leaveClub(db, user.id, Number(clubLeave[1]));
    if (r.error) return json({ error: r.error }, 400);
    return json({ ok: true, ...(await core.listClubsForUser(db, user.id)) });
  }
  const clubTransfer = path.match(/^\/api\/clubs\/(\d+)\/transfer$/);
  if (clubTransfer && method === "POST") {
    const { userId: targetUserId } = await readBody(req);
    if (targetUserId == null) return json({ error: "userId is required" }, 400);
    const r = await core.transferClubOwnership(db, user.id, Number(clubTransfer[1]), Number(targetUserId));
    if (r.error) return json({ error: r.error }, 400);
    return json(r);
  }
  const clubEvents = path.match(/^\/api\/clubs\/(\d+)\/events$/);
  if (clubEvents && method === "GET") {
    const targetClubId = Number(clubEvents[1]);
    // Must be a member before we hold a stream open for them.
    const initial = await core.getClub(db, user.id, targetClubId);
    if (initial.error) {
      return json({ error: initial.error }, initial.error === "Club not found" ? 404 : 403);
    }
    const initialVersion = await core.getClubVersion(db, targetClubId);

    const encoder = new TextEncoder();
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        let lastVersion = initialVersion;
        let lastPing = Date.now();

        const send = (chunk: string) => {
          if (!alive) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            alive = false;
          }
        };
        const close = () => {
          if (!alive) return;
          alive = false;
          if (timer) clearInterval(timer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        const tick = async () => {
          if (!alive || req.signal.aborted) return close();
          try {
            const version = await core.getClubVersion(db, targetClubId);
            if (version === lastVersion) {
              // Keepalive comment so proxies don't idle out the connection.
              if (Date.now() - lastPing > 15000) {
                send(": ping\n\n");
                lastPing = Date.now();
              }
              return;
            }
            lastVersion = version;
            const detail = await core.getClub(db, user.id, targetClubId);
            if (detail.error) {
              // Club deleted or membership revoked mid-stream.
              send(`event: gone\ndata: ${JSON.stringify({ error: detail.error })}\n\n`);
              return close();
            }
            lastPing = Date.now();
            send(`data: ${JSON.stringify({ club: detail.club })}\n\n`);
          } catch {
            close();
          }
        };

        // Tell the browser's EventSource to reconnect quickly after the
        // server-side close below.
        send("retry: 2000\n\n");
        send(`data: ${JSON.stringify({ club: initial.club })}\n\n`);
        // Half-second change checks keep vote counts effectively real-time.
        // The lifetime keeps version checks within the Workers subrequest
        // budget; the EventSource reconnects automatically (the client's
        // poll fallback covers the brief gap).
        timer = setInterval(tick, 500);
        setTimeout(() => close(), 20_000);
      },
      cancel() {
        alive = false;
        if (timer) clearInterval(timer);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
      },
    });
  }
  const clubMatch = path.match(/^\/api\/clubs\/(\d+)$/);
  if (clubMatch && method === "GET") {
    const r = await core.getClub(db, user.id, Number(clubMatch[1]));
    if (r.error) return json({ error: r.error }, r.error === "Club not found" ? 404 : 403);
    return json({ club: r.club });
  }
  if (clubMatch && method === "DELETE") {
    const r = await core.deleteClub(db, user.id, Number(clubMatch[1]));
    if (r.error) return json({ error: r.error }, 400);
    return json({ ok: true });
  }

  // ----- notifications -----
  if (path === "/api/notifications" && method === "GET") {
    return json(await core.getNotifications(db, user.id));
  }

  if (path === "/api/notifications/seen" && method === "POST") {
    await core.markInformationalNotificationsRead(db, user.id);
    return json(await core.getNotifications(db, user.id));
  }

  // ----- user approval (admin) -----
  const approveUserMatch = path.match(/^\/api\/users\/(\d+)\/approve$/);
  if (approveUserMatch && method === "POST") {
    if (!user.is_admin) return json({ error: "Unauthorized" }, 403);
    const targetUserId = Number(approveUserMatch[1]);
    await core.approveUser(db, targetUserId);

    // Dismiss the related notification
    const notification = await queryOne<{ id: number }>(
      db,
      "SELECT id FROM notifications WHERE type = 'new_user_signup' AND data LIKE ? LIMIT 1",
      `%"id":${targetUserId},%`,
    );
    if (notification) {
      await core.dismissNotification(db, user.id, notification.id);
    }

    return json({ ok: true });
  }

  const rejectUserMatch = path.match(/^\/api\/users\/(\d+)\/reject$/);
  if (rejectUserMatch && method === "POST") {
    if (!user.is_admin) return json({ error: "Unauthorized" }, 403);
    const targetUserId = Number(rejectUserMatch[1]);
    await core.rejectUser(db, targetUserId);

    // Dismiss the related notification
    const notification = await queryOne<{ id: number }>(
      db,
      "SELECT id FROM notifications WHERE type = 'new_user_signup' AND data LIKE ? LIMIT 1",
      `%"id":${targetUserId},%`,
    );
    if (notification) {
      await core.dismissNotification(db, user.id, notification.id);
    }

    return json({ ok: true });
  }

  // Cleanup rejected users after grace period
  if (path === "/api/admin/cleanup-rejected" && method === "POST") {
    if (!user.is_admin) return json({ error: "Unauthorized" }, 403);
    const result = await core.cleanupRejectedUsers(db);
    return json({ ok: true, deleted: result.deleted });
  }

  return json({ error: "Not found" }, 404);
}
