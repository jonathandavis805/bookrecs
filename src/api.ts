import { db } from "./db";
import * as auth from "./auth";
import * as core from "./core";
import { searchBooks } from "./ol";
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
  // Check X-Forwarded-For first (for reverse proxies like cloudflared)
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  // Check CF-Connecting-IP (Cloudflare specific)
  const cloudflare = req.headers.get("cf-connecting-ip");
  if (cloudflare) {
    return cloudflare;
  }
  // Fallback to a generic identifier
  return "unknown";
}

function sessionUser(req: Request): core.User | null {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const id = auth.getUserIdByToken(token);
  return id ? core.getUserById(id) : null;
}

function bearerUser(req: Request): core.User | null {
  const h = req.headers.get("authorization");
  if (!h || !h.toLowerCase().startsWith("bearer ")) return null;
  const token = h.slice(7).trim();
  const row = db.query("SELECT id FROM users WHERE api_token = ?").get(token) as { id: number } | undefined;
  return row ? core.getUserById(row.id) : null;
}

function setSessionCookie(token: string, req: Request): string {
  const host = req.headers.get("host") || "localhost";
  const protocol = req.headers.get("x-forwarded-proto") || "http";
  const isSecure = protocol === "https" || host.includes("bookrecs.dev");
  
  const secureFlag = isSecure ? "Secure; " : "";
  const domain = host.includes("bookrecs.dev") ? "; Domain=bookrecs.dev" : "";
  
  return `${SESSION_COOKIE}=${token}; HttpOnly; ${secureFlag}Path=/${domain}; SameSite=None; Max-Age=${SESSION_TTL}`;
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

async function handleSignup(username: unknown, email: unknown, password: unknown, req: Request): Promise<Response> {
  if (!validUsername(username)) return json({ error: "Username must be 3-32 chars (letters, numbers, underscore)" }, 400);
  if (!validEmail(email)) return json({ error: "Enter a valid email address" }, 400);
  if (!validPassword(password)) return json({ error: "Password must be at least 8 characters" }, 400);
  if (core.usernameExists(username)) return json({ error: "That username is taken" }, 409);
  if (core.emailExists(email)) return json({ error: "That email is already registered" }, 409);

  const hash = await auth.hashPassword(password);
  const user = core.createUser(username, email, hash);
  const token = auth.createSession(user.id);
  return json({ user }, 200, { "set-cookie": setSessionCookie(token, req) });
}

async function handleLogin(usernameOrEmail: unknown, password: unknown, req: Request): Promise<Response> {
  if (typeof usernameOrEmail !== "string" || !usernameOrEmail.trim() || typeof password !== "string" || !password) {
    return json({ error: "Username/email and password are required" }, 400);
  }

  // Check rate limiting
  const ip = getClientIp(req);
  const identifier = usernameOrEmail.trim();
  
  if (ratelimit.isBlocked(ip, identifier)) {
    return json({ 
      error: "Too many failed login attempts. Please try again in 15 minutes." 
    }, 429);
  }

  const u = core.findUser(usernameOrEmail.trim());
  if (!u) {
    ratelimit.recordFailedAttempt(ip, identifier);
    return json({ error: "Invalid credentials" }, 401);
  }
  
  const ok = await auth.verifyPassword(password, u.password_hash);
  if (!ok) {
    ratelimit.recordFailedAttempt(ip, identifier);
    return json({ error: "Invalid credentials" }, 401);
  }
  
  // Check if 2FA is enabled
  if (twofa.has2FAEnabled(u.id)) {
    // Return pending login token (valid for 5 minutes)
    const pendingToken = auth.randomToken(24);
    db.query("INSERT INTO pending_logins (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(pendingToken, u.id, now() + 300);
    return json({ requires2FA: true, pendingToken });
  }
  
  // Clear rate limit on successful login
  ratelimit.clearAttempts(ip, identifier);
  
  const token = auth.createSession(u.id);
  return json({ user: { id: u.id, username: u.username, email: u.email } }, 200, {
    "set-cookie": setSessionCookie(token, req),
  });
}

export async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // ----- auth -----
  if (path === "/api/signup" && method === "POST") {
    const { username, email, password } = await readBody(req);
    return handleSignup(username, email, password, req);
  }
  if (path === "/api/login" && method === "POST") {
    const { usernameOrEmail, password } = await readBody(req);
    return handleLogin(usernameOrEmail, password, req);
  }
  if (path === "/api/logout" && method === "POST") {
    const token = getCookie(req, SESSION_COOKIE);
    if (token) auth.deleteSession(token);
    return json({ ok: true });
  }
  if (path === "/api/me" && method === "GET") {
    const user = sessionUser(req) ?? bearerUser(req);
    return json({ user });
  }
  if (path === "/api/token" && method === "POST") {
    const user = sessionUser(req) ?? bearerUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const token = auth.randomToken(24);
    db.query("UPDATE users SET api_token = ? WHERE id = ?").run(token, user.id);
    return json({ token });
  }

  // ----- 2FA setup -----
  if (path === "/api/2fa/setup" && method === "POST") {
    const user = sessionUser(req) ?? bearerUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    
    const secret = twofa.generateSecret();
    const uri = twofa.generateTOTPUri(user.username, secret);
    
    // Store secret temporarily (not enabled yet)
    db.query('UPDATE users SET "2fa_secret" = ? WHERE id = ?').run(secret, user.id);
    
    return json({ secret, uri });
  }

  if (path === "/api/2fa/verify" && method === "POST") {
    const user = sessionUser(req) ?? bearerUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    
    const { token } = await readBody(req);
    if (!token) return json({ error: "Token required" }, 400);
    
    const secret = twofa.get2FASecret(user.id);
    if (!secret) return json({ error: "No 2FA setup in progress" }, 400);
    
    const valid = twofa.verifyTOTP(user.username, secret, token);
    if (!valid) return json({ error: "Invalid token" }, 400);
    
    // Enable 2FA
    twofa.enable2FA(user.id, secret);
    
    return json({ ok: true });
  }

  if (path === "/api/2fa/disable" && method === "POST") {
    const user = sessionUser(req) ?? bearerUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    
    twofa.disable2FA(user.id);
    return json({ ok: true });
  }

  if (path === "/api/2fa/status" && method === "GET") {
    const user = sessionUser(req) ?? bearerUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    
    return json(twofa.get2FAStatus(user.id));
  }

  if (path === "/api/2fa/login" && method === "POST") {
    const { pendingToken, totpToken } = await readBody(req);
    if (!pendingToken || !totpToken) {
      return json({ error: "pendingToken and totpToken required" }, 400);
    }
    
    // Get pending login
    const pending = db.query("SELECT user_id, expires_at FROM pending_logins WHERE token = ?")
      .get(pendingToken) as { user_id: number; expires_at: number } | undefined;
    
    if (!pending || pending.expires_at < now()) {
      if (pending) {
        db.query("DELETE FROM pending_logins WHERE token = ?").run(pendingToken);
      }
      return json({ error: "Invalid or expired pending token" }, 400);
    }
    
    // Verify TOTP
    const user = core.getUserById(pending.user_id);
    if (!user) {
      return json({ error: "User not found" }, 404);
    }
    
    const secret = twofa.get2FASecret(pending.user_id);
    if (!secret) {
      return json({ error: "2FA not configured" }, 400);
    }
    
    const valid = twofa.verifyTOTP(user.username, secret, totpToken);
    if (!valid) {
      return json({ error: "Invalid 2FA token" }, 400);
    }
    
    // Delete pending login
    db.query("DELETE FROM pending_logins WHERE token = ?").run(pendingToken);
    
    // Create session
    const token = auth.createSession(user.id);
    return json({ user: { id: user.id, username: user.username, email: user.email } }, 200, {
      "set-cookie": setSessionCookie(token, req),
    });
  }

  const user = sessionUser(req) ?? bearerUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  // ----- book search & add -----
  if (path === "/api/books/search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return json({ results: [] });
    try {
      const results = await searchBooks(q);
      // Check which books already exist in the database (added by someone)
      const keys = results.map(r => r.key);
      const existingKeys = core.getExistingBookKeys(keys);
      // Sort results: books that exist in the database come first
      const sorted = results.sort((a, b) => {
        const aExists = existingKeys.has(a.key);
        const bExists = existingKeys.has(b.key);
        if (aExists && !bExists) return -1;
        if (!aExists && bExists) return 1;
        return 0;
      });
      // Add the 'added' flag to each result
      const resultsWithFlag = sorted.map(r => ({
        ...r,
        added: existingKeys.has(r.key)
      }));
      return json({ results: resultsWithFlag });
    } catch (e) {
      return json({ error: "Open Library is unavailable right now", detail: String(e) }, 502);
    }
  }

  // Get book details with friend activity
  const bookDetailMatch = path.match(/^\/api\/books\/(\d+)$/);
  if (bookDetailMatch && method === "GET") {
    const bookId = Number(bookDetailMatch[1]);
    const detail = core.getBookDetail(user.id, bookId);
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
    const updated = core.setBookCover(bookId, cover_url);
    if (!updated) return json({ error: "Book not found" }, 404);
    return json({ book: updated });
  }

  // Backfill synopses from Open Library
  if (path === "/api/books/backfill-synopses" && method === "POST") {
    try {
      const result = await core.backfillSynopses();
      return json(result);
    } catch (e) {
      return json({ error: "Failed to backfill synopses", detail: String(e) }, 500);
    }
  }

  if (path === "/api/books/manual" && method === "POST") {
    const { title, author, year, coverUrl, review, rank, public: isPublic } = await readBody(req);
    const r = core.addManualBook(
      user.id,
      { title, author, year: year != null && year !== "" ? Number(year) : undefined, coverUrl },
      review,
      rank,
      isPublic
    );
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: core.listReads(user.id) });
  }

  if (path === "/api/books" && method === "POST") {
    const { ol_key, review, rank, year, public: isPublic } = await readBody(req);
    const r = await core.addRead(user.id, ol_key, review, rank, year, isPublic);
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: core.listReads(user.id) });
  }

  if (path === "/api/me/books" && method === "GET") {
    const books = core.listReads(user.id);
    const readingSet = new Set(
      core.listReading(user.id).map(b => b.book_id)
    );
    const booksWithReadingStatus = books.map(b => ({
      ...b,
      isReading: readingSet.has(b.book_id)
    }));
    return json({ books: booksWithReadingStatus });
  }

  if (path === "/api/me/books/reorder" && method === "POST") {
    const { ordered } = await readBody(req);
    core.reorderReads(user.id, Array.isArray(ordered) ? ordered.map(Number) : []);
    return json({ books: core.listReads(user.id) });
  }

  const bookMatch = path.match(/^\/api\/me\/books\/(\d+)$/);
  if (bookMatch) {
    const bookId = Number(bookMatch[1]);
    if (method === "PATCH") {
      const { review, rank } = await readBody(req);
      if (rank != null) {
        const r = core.setRank(user.id, bookId, Number(rank));
        if (r.error) return json({ error: r.error }, 400);
      }
      if (typeof review === "string") core.setReview(user.id, bookId, review);
      return json({ books: core.listReads(user.id) });
    }
    if (method === "DELETE") {
      core.removeRead(user.id, bookId);
      return json({ books: core.listReads(user.id) });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const readPublic = path.match(/^\/api\/me\/books\/(\d+)\/public$/);
  if (readPublic && method === "POST") {
    const { public: isPublic } = await readBody(req);
    const r = core.setReadPublic(user.id, Number(readPublic[1]), !!isPublic);
    if (r.error) return json({ error: r.error }, 400);
    return json({ books: core.listReads(user.id) });
  }

  // ----- wishlist (self) -----
  if (path === "/api/me/next-up" && method === "GET") {
    return json({ books: core.getNextUp(user.id) });
  }
  if (path === "/api/me/wishlist" && method === "GET") {
    return json({ books: core.listWishlist(user.id) });
  }
  if (path === "/api/me/wishlist" && method === "POST") {
    const { ol_key, book_id, owned, public: isPublic, year, rank } = await readBody(req);
    if (book_id != null) {
      const r = core.addToWishlistByBookId(user.id, Number(book_id), !!owned, !!isPublic, rank);
      if (r.error) return json({ error: r.error }, 400);
      return json({ book: r.book, books: core.listWishlist(user.id) });
    }
    const r = await core.addToWishlistByOlKey(user.id, ol_key, !!owned, year, !!isPublic, rank);
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: core.listWishlist(user.id) });
  }
  if (path === "/api/me/wishlist/manual" && method === "POST") {
    const { title, author, year, coverUrl, owned, public: isPublic, rank } = await readBody(req);
    const r = core.addManualToWishlist(
      user.id,
      {
        title,
        author,
        year: year != null && year !== "" ? Number(year) : undefined,
        coverUrl,
      },
      !!owned,
      !!isPublic,
      rank
    );
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: core.listWishlist(user.id) });
  }
  if (path === "/api/me/wishlist/reorder" && method === "POST") {
    const { ordered } = await readBody(req);
    core.reorderWishlist(user.id, Array.isArray(ordered) ? ordered.map(Number) : []);
    return json({ books: core.listWishlist(user.id) });
  }
  const wishPublic = path.match(/^\/api\/me\/wishlist\/(\d+)\/public$/);
  if (wishPublic && method === "POST") {
    const { public: isPublic } = await readBody(req);
    const r = core.setWishPublic(user.id, Number(wishPublic[1]), !!isPublic);
    if (r.error) return json({ error: r.error }, 400);
    return json({ books: core.listWishlist(user.id) });
  }
  const wishMove = path.match(/^\/api\/me\/wishlist\/(\d+)\/move-to-read$/);
  if (wishMove && method === "POST") {
    const { review, rank } = await readBody(req);
    const r = core.moveToRead(user.id, Number(wishMove[1]), review, rank);
    if (r.error) return json({ error: r.error }, 400);
    return json({ ok: true, books: core.listWishlist(user.id), readBooks: core.listReads(user.id) });
  }
  const wishOwned = path.match(/^\/api\/me\/wishlist\/(\d+)\/owned$/);
  if (wishOwned && method === "POST") {
    const { owned } = await readBody(req);
    const r = core.setOwned(user.id, Number(wishOwned[1]), !!owned);
    if (r.error) return json({ error: r.error }, 400);
    return json({ books: core.listWishlist(user.id) });
  }
  const wishMatch = path.match(/^\/api\/me\/wishlist\/(\d+)$/);
  if (wishMatch && method === "DELETE") {
    core.removeFromWishlist(user.id, Number(wishMatch[1]));
    return json({ books: core.listWishlist(user.id) });
  }

  // ----- currently reading (always visible to friends) -----
  if (path === "/api/me/reading" && method === "GET") {
    return json({ books: core.listReading(user.id) });
  }
  if (path === "/api/me/reading" && method === "POST") {
    const { ol_key, book_id, year } = await readBody(req);
    if (book_id != null) {
      const r = core.addToReadingByBookId(user.id, Number(book_id));
      if (r.error) return json({ error: r.error }, 400);
      return json({ book: r.book, books: core.listReading(user.id) });
    }
    const r = await core.addToReadingByOlKey(user.id, ol_key, year);
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: core.listReading(user.id) });
  }
  if (path === "/api/me/reading/from-wishlist" && method === "POST") {
    const { book_id } = await readBody(req);
    const r = core.moveFromWishlistToReading(user.id, Number(book_id));
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: core.listReading(user.id), wishBooks: core.listWishlist(user.id) });
  }
  if (path === "/api/me/reading/manual" && method === "POST") {
    const { title, author, year, coverUrl } = await readBody(req);
    const r = core.addManualToReading(user.id, {
      title,
      author,
      year: year != null && year !== "" ? Number(year) : undefined,
      coverUrl,
    });
    if (r.error) return json({ error: r.error }, 400);
    return json({ book: r.book, books: core.listReading(user.id) });
  }
  const readingFinish = path.match(/^\/api\/me\/reading\/(\d+)\/finish$/);
  if (readingFinish && method === "POST") {
    const { review, rank } = await readBody(req);
    const r = core.finishReading(user.id, Number(readingFinish[1]), review, rank);
    if (r.error) return json({ error: r.error }, 400);
    return json({ ok: true, readBooks: core.listReads(user.id) });
  }
  const readingBack = path.match(/^\/api\/me\/reading\/(\d+)\/back-to-wishlist$/);
  if (readingBack && method === "POST") {
    const r = core.backToWishlist(user.id, Number(readingBack[1]));
    if (r.error) return json({ error: r.error }, 400);
    return json({ 
      ok: true, 
      wishBooks: core.listWishlist(user.id),
      books: core.listReading(user.id)
    });
  }
  const readingMatch = path.match(/^\/api\/me\/reading\/(\d+)$/);
  if (readingMatch && method === "DELETE") {
    core.removeFromReading(user.id, Number(readingMatch[1]));
    return json({ 
      books: core.listReading(user.id),
      wishBooks: core.listWishlist(user.id)
    });
  }

  // ----- users -----
  if (path === "/api/users/search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return json({ users: [] });
    return json({ users: core.searchUsers(q, user.id) });
  }

  // ----- friends -----
  if (path === "/api/friends" && method === "GET") {
    return json({ friends: core.listFriends(user.id) });
  }
  if (path === "/api/friends/requests" && method === "GET") {
    return json(core.listFriendRequests(user.id));
  }
  if (path === "/api/friends/requests" && method === "POST") {
    const { usernameOrEmail } = await readBody(req);
    const r = core.sendFriendRequest(user.id, usernameOrEmail);
    if (r.error) return json({ error: r.error }, 400);
    return json(r);
  }
  const requestAction = path.match(/^\/api\/friends\/requests\/(\d+)\/(accept|decline)$/);
  if (requestAction && method === "POST") {
    const id = Number(requestAction[1]);
    const r = requestAction[2] === "accept"
      ? core.acceptFriendRequest(user.id, id)
      : core.declineFriendRequest(user.id, id);
    if (r.error) return json({ error: r.error }, 404);
    return json(r);
  }
  const friendBooks = path.match(/^\/api\/friends\/([^/]+)\/books$/);
  if (friendBooks && method === "GET") {
    const r = core.getFriendReads(user.id, decodeURIComponent(friendBooks[1]));
    if (r.error) return json({ error: r.error }, r.error === "User not found" ? 404 : 403);
    return json({ user: r.user, books: r.books });
  }
  const friendWish = path.match(/^\/api\/friends\/([^/]+)\/wishlist$/);
  if (friendWish && method === "GET") {
    const r = core.getFriendWishlist(user.id, decodeURIComponent(friendWish[1]));
    if (r.error) return json({ error: r.error }, r.error === "User not found" ? 404 : 403);
    return json({ user: r.user, books: r.books });
  }
  const friendReading = path.match(/^\/api\/friends\/([^/]+)\/reading$/);
  if (friendReading && method === "GET") {
    const r = core.getFriendReading(user.id, decodeURIComponent(friendReading[1]));
    if (r.error) return json({ error: r.error }, r.error === "User not found" ? 404 : 403);
    return json({ user: r.user, books: r.books });
  }
  const unfriend = path.match(/^\/api\/friends\/(\d+)$/);
  if (unfriend && method === "DELETE") {
    core.removeFriend(user.id, Number(unfriend[1]));
    return json({ friends: core.listFriends(user.id) });
  }

  return json({ error: "Not found" }, 404);
}
