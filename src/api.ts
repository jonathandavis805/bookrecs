import * as auth from "./auth";
import * as core from "./core";
import { isLatin, normalizeTitle, searchBooks } from "./ol";
import * as ratelimit from "./ratelimit";

const SESSION_COOKIE = "session";

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

const failure = (r: core.Failure) => json({ error: r.error }, r.status);

function getCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx !== -1 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

// biome-ignore lint/suspicious/noExplicitAny: request bodies are validated field by field
async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

const optionalNumber = (v: unknown) => (v == null || v === "" ? undefined : Number(v));
const idList = (v: unknown) => (Array.isArray(v) ? v.map(Number) : []);

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("cf-connecting-ip") ?? "unknown";
}

async function authenticate(db: D1Database, req: Request): Promise<core.User | null> {
  const session = getCookie(req, SESSION_COOKIE);
  if (session) {
    const id = await auth.getUserIdByToken(db, session);
    if (id) return await core.getUserById(db, id);
  }
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return await core.getUserByApiToken(db, header.slice(7).trim());
  return null;
}

// Lax keeps the cookie off cross-site POSTs, so another site can't act as the user.
function sessionCookie(token: string, req: Request): string {
  const host = req.headers.get("host") || "localhost";
  const secure = (req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "")) === "https";
  const domain = host.endsWith("bookrecs.dev") ? "; Domain=bookrecs.dev" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}${domain}; Max-Age=${auth.SESSION_TTL}`;
}

// The one user shape every endpoint returns.
function publicUser(u: core.User) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    is_admin: u.is_admin,
    bookLimit: u.book_limit === 0 ? null : u.book_limit,
    discoverable: !!u.discoverable,
    theme: u.theme ? JSON.parse(u.theme) : null,
  };
}

async function startSession(db: D1Database, user: core.User, req: Request): Promise<Response> {
  const token = await auth.createSession(db, user.id);
  return json({ user: publicUser(user) }, 200, { "set-cookie": sessionCookie(token, req) });
}

const validUsername = (u: unknown): u is string => typeof u === "string" && /^[a-zA-Z0-9_]{3,32}$/.test(u);
const validEmail = (e: unknown): e is string => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPassword = (p: unknown): p is string => typeof p === "string" && p.length >= 8;

async function handleSignup(db: D1Database, req: Request): Promise<Response> {
  const { username, email, password } = await readBody(req);
  if (!validUsername(username))
    return json({ error: "Username must be 3-32 chars (letters, numbers, underscore)" }, 400);
  if (!validEmail(email)) return json({ error: "Enter a valid email address" }, 400);
  if (!validPassword(password)) return json({ error: "Password must be at least 8 characters" }, 400);
  if (await core.usernameExists(db, username)) return json({ error: "That username is taken" }, 409);
  if (await core.emailExists(db, email)) return json({ error: "That email is already registered" }, 409);

  const user = await core.createUser(db, username, email, await auth.hashPassword(password));
  await core.notifyAdminsOfSignup(db, user);
  return await startSession(db, user, req);
}

async function handleLogin(db: D1Database, req: Request): Promise<Response> {
  const { usernameOrEmail, password } = await readBody(req);
  if (typeof usernameOrEmail !== "string" || !usernameOrEmail.trim() || typeof password !== "string" || !password) {
    return json({ error: "Username/email and password are required" }, 400);
  }
  const ip = getClientIp(req);
  const identifier = usernameOrEmail.trim();
  if (await ratelimit.isBlocked(db, ip, identifier)) {
    return json({ error: "Too many failed login attempts. Please try again in 15 minutes." }, 429);
  }
  const user = await core.findUser(db, identifier);
  if (!user || !(await auth.verifyPassword(password, user.password_hash))) {
    await ratelimit.recordFailedAttempt(db, ip, identifier);
    return json({ error: "Invalid credentials" }, 401);
  }
  await ratelimit.clearAttempts(db, ip, identifier);
  return await startSession(db, user, req);
}

async function handleBookSearch(db: D1Database, user: core.User, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return json({ results: [] });
  // mine=1 (club nomination search) also surfaces the user's own books
  // from their reading/wishlist/read lists, ahead of Open Library hits.
  const mine = url.searchParams.get("mine") === "1" ? await core.searchMyBooks(db, user.id, q) : [];
  const mineKeys = new Set(mine.map((m) => m.key));
  const mineTitles = new Set(mine.map((m) => normalizeTitle(m.title)));
  const mineResults = mine.map(({ list, ...m }) => ({ ...m, added: true, mine: list }));
  try {
    const results = await searchBooks(q);
    const status = await core.viewerOwnership(db, user.id);
    const existing = await core.getExistingBookKeys(
      db,
      results.map((r) => r.key),
    );
    // Books already in the system surface near the top (with the "added"
    // flag), but that boost must never override language preference: for a
    // Latin-script query, a foreign-script title ranks below every
    // Latin-script one even if it's already in the system. Buckets:
    // 0 = Latin + added, 1 = Latin + new, 2 = foreign + added, 3 = foreign + new.
    const rank = (r: { key: string; title: string }) =>
      (isLatin(q) && !isLatin(r.title) ? 2 : 0) + (existing.has(r.key) ? 0 : 1);
    const olResults = results
      .sort((a, b) => rank(a) - rank(b))
      .filter((r) => !mineKeys.has(r.key) && !mineTitles.has(normalizeTitle(r.title)))
      .map((r) => ({ ...r, added: existing.has(r.key), mine: status(existing.get(r.key) ?? 0) }));
    return json({ results: [...mineResults, ...olResults] });
  } catch (e) {
    // Open Library is down, but the user's own matches are still useful.
    if (mineResults.length > 0) return json({ results: mineResults });
    return json({ error: "Open Library is unavailable right now", detail: String(e) }, 502);
  }
}

function clubEvents(db: D1Database, req: Request, userId: number, clubId: number, initial: core.ClubDetail) {
  const encoder = new TextEncoder();
  let alive = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let lastVersion = await core.getClubVersion(db, clubId);
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
          const version = await core.getClubVersion(db, clubId);
          if (version === lastVersion) {
            // Keepalive comment so proxies don't idle out the connection.
            if (Date.now() - lastPing > 15000) {
              send(": ping\n\n");
              lastPing = Date.now();
            }
            return;
          }
          lastVersion = version;
          const detail = await core.getClub(db, userId, clubId);
          if (!detail.ok) {
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
      send(`data: ${JSON.stringify({ club: initial })}\n\n`);
      // Half-second change checks keep the page effectively real-time.
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
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
  });
}

export async function handleApi(db: D1Database, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // ----- public -----
  if (path === "/api/signup" && method === "POST") return await handleSignup(db, req);
  if (path === "/api/login" && method === "POST") return await handleLogin(db, req);
  if (path === "/api/logout" && method === "POST") {
    const token = getCookie(req, SESSION_COOKIE);
    if (token) await auth.deleteSession(db, token);
    return json({ ok: true });
  }

  const user = await authenticate(db, req);
  if (path === "/api/me" && method === "GET") return json({ user: user && publicUser(user) });
  if (!user) return json({ error: "Unauthorized" }, 401);

  // All three lists, after a move between them.
  const lists = async () => ({
    reads: await core.listReads(db, user.id),
    wishlist: await core.listWishlist(db, user.id),
    reading: await core.listReading(db, user.id),
  });
  // A club page's state after a change; the caller may have just left it.
  const clubResponse = async (clubId: number) => {
    const detail = await core.getClub(db, user.id, clubId);
    return json(detail.ok ? { club: detail.club } : { ok: true });
  };
  const clubsResponse = async () => json({ ok: true, ...(await core.listClubsForUser(db, user.id)) });

  // ----- account -----
  if (path === "/api/me/privacy" && method === "GET") return json({ discoverable: !!user.discoverable });
  if (path === "/api/me/privacy" && method === "POST") {
    const { discoverable } = await readBody(req);
    await core.setDiscoverable(db, user.id, !!discoverable);
    return json({ ok: true, discoverable: !!discoverable });
  }
  if (path === "/api/me/theme" && method === "POST") {
    const { theme } = await readBody(req);
    const stored = JSON.stringify(theme);
    // The client validates on load; the server only keeps junk and huge blobs out.
    if (!theme || typeof theme !== "object" || stored.length > 2000) return json({ error: "Invalid theme" }, 400);
    await core.setTheme(db, user.id, stored);
    return json({ ok: true });
  }
  if (path === "/api/token" && method === "POST") {
    const token = auth.randomToken(24);
    await core.setApiToken(db, user.id, token);
    return json({ token });
  }
  if (path === "/api/change-password" && method === "POST") {
    const { currentPassword, newPassword } = await readBody(req);
    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return json({ error: "Current and new password are required" }, 400);
    }
    if (!validPassword(newPassword)) return json({ error: "New password must be at least 8 characters" }, 400);
    const withHash = await core.findUser(db, user.username);
    if (!withHash || !(await auth.verifyPassword(currentPassword, withHash.password_hash))) {
      return json({ error: "Current password is incorrect" }, 401);
    }
    await core.setPassword(db, user.id, await auth.hashPassword(newPassword));
    return json({ ok: true });
  }

  // ----- books -----
  if (path === "/api/books/search" && method === "GET") return await handleBookSearch(db, user, url);

  const bookMatch = path.match(/^\/api\/books\/(\d+)$/);
  if (bookMatch && method === "GET") {
    const book = await core.getBookDetail(db, user.id, Number(bookMatch[1]));
    return book ? json({ book }) : json({ error: "Book not found" }, 404);
  }
  const coverMatch = path.match(/^\/api\/books\/(\d+)\/cover$/);
  if (coverMatch && method === "POST") {
    const { cover_url } = await readBody(req);
    if (!cover_url || typeof cover_url !== "string") return json({ error: "Cover URL is required" }, 400);
    const book = await core.setBookCover(db, Number(coverMatch[1]), cover_url);
    return book ? json({ book }) : json({ error: "Book not found" }, 404);
  }

  // ----- reads -----
  if ((path === "/api/books" || path === "/api/books/manual") && method === "POST") {
    const body = await readBody(req);
    const allowance = await core.getBookAllowance(db, user.id);
    if (!allowance.canAdd) return json({ error: `You have reached the maximum of ${allowance.limit} books` }, 400);
    const ref =
      path === "/api/books/manual" ? { manual: body } : { olKey: body.ol_key, year: optionalNumber(body.year) };
    const r = await core.addRead(db, user.id, ref, {
      review: body.review,
      rank: optionalNumber(body.rank),
      isPublic: body.public,
    });
    if (!r.ok) return failure(r);
    if (body.category_ids) await core.setBookCategories(db, user.id, r.book.id, idList(body.category_ids));
    return json({ book: r.book, books: await core.listReads(db, user.id) });
  }
  if (path === "/api/me/books" && method === "GET") {
    const books = await core.listReads(db, user.id);
    const reading = new Set((await core.listReading(db, user.id)).map((b) => b.book_id));
    const { count, limit } = await core.getBookAllowance(db, user.id);
    return json({
      books: books.map((b) => ({ ...b, isReading: reading.has(b.book_id) })),
      categories: await core.listCategories(db, user.id),
      bookCount: count,
      maxBooks: limit,
    });
  }
  if (path === "/api/me/books/reorder" && method === "POST") {
    const { ordered } = await readBody(req);
    await core.reorderList(db, "reads", user.id, Array.isArray(ordered) ? ordered.map(Number) : []);
    return json({ books: await core.listReads(db, user.id) });
  }
  const bookCategories = path.match(/^\/api\/me\/books\/(\d+)\/categories$/);
  if (bookCategories && method === "POST") {
    const { category_ids } = await readBody(req);
    const r = await core.setBookCategories(db, user.id, Number(bookCategories[1]), idList(category_ids));
    if (!r.ok) return failure(r);
    return json({ books: await core.listReads(db, user.id) });
  }
  const readMatch = path.match(/^\/api\/me\/books\/(\d+)$/);
  if (readMatch && method === "PATCH") {
    const bookId = Number(readMatch[1]);
    const { review, rank } = await readBody(req);
    if (rank != null) {
      const r = await core.setRank(db, user.id, bookId, Number(rank));
      if (!r.ok) return failure(r);
    }
    if (typeof review === "string") {
      const r = await core.setReview(db, user.id, bookId, review);
      if (!r.ok) return failure(r);
    }
    return json({ books: await core.listReads(db, user.id) });
  }
  const listened = path.match(/^\/api\/me\/books\/(\d+)\/listened$/);
  if (listened && method === "POST") {
    const body = await readBody(req);
    const r = await core.setListened(db, user.id, Number(listened[1]), !!body.listened);
    if (!r.ok) return failure(r);
    return json({ books: await core.listReads(db, user.id) });
  }
  if (readMatch && method === "DELETE") {
    await core.removeRead(db, user.id, Number(readMatch[1]));
    return json({ books: await core.listReads(db, user.id) });
  }

  if (path === "/api/me/status" && method === "POST") {
    const { status, book_id, ol_key, year } = await readBody(req);
    if (status !== "reading" && status !== "wish" && status !== "read") return json({ error: "Invalid status" }, 400);
    const ref = { bookId: optionalNumber(book_id), olKey: ol_key, year: optionalNumber(year) };
    const r = await core.setStatus(db, user.id, ref, status);
    return r.ok ? json({ book: r.book, mine: status }) : failure(r);
  }

  const visibility = path.match(/^\/api\/me\/(books|wishlist)\/(\d+)\/public$/);
  if (visibility && method === "POST") {
    const list = visibility[1] === "books" ? "reads" : "wishlist";
    const { public: isPublic } = await readBody(req);
    const r = await core.setVisibility(db, list, user.id, Number(visibility[2]), !!isPublic);
    if (!r.ok) return failure(r);
    return json({ books: list === "reads" ? await core.listReads(db, user.id) : await core.listWishlist(db, user.id) });
  }

  // ----- categories -----
  const categories = async () => json({ categories: await core.listCategories(db, user.id) });
  if (path === "/api/me/categories" && method === "GET") return await categories();
  if (path === "/api/me/categories" && method === "POST") {
    const { name } = await readBody(req);
    const r = await core.createCategory(db, user.id, name);
    if (!r.ok) return failure(r);
    return json({ category: r.category, categories: await core.listCategories(db, user.id) });
  }
  const categoryReorder = path.match(/^\/api\/me\/categories\/(\d+)\/reorder$/);
  if (categoryReorder && method === "POST") {
    const { ordered } = await readBody(req);
    const r = await core.reorderCategory(db, user.id, Number(categoryReorder[1]), idList(ordered));
    if (!r.ok) return failure(r);
    return json({ books: await core.listReads(db, user.id) });
  }
  const categoryMatch = path.match(/^\/api\/me\/categories\/(\d+)$/);
  if (categoryMatch && method === "PATCH") {
    const { name } = await readBody(req);
    const r = await core.renameCategory(db, user.id, Number(categoryMatch[1]), name);
    return r.ok ? await categories() : failure(r);
  }
  if (categoryMatch && method === "DELETE") {
    const r = await core.deleteCategory(db, user.id, Number(categoryMatch[1]));
    return r.ok ? await categories() : failure(r);
  }

  // ----- wishlist -----
  if (path === "/api/me/next-up" && method === "GET") return json({ books: await core.getNextUp(db, user.id) });
  if (path === "/api/me/wishlist" && method === "GET") return json({ books: await core.listWishlist(db, user.id) });
  if ((path === "/api/me/wishlist" || path === "/api/me/wishlist/manual") && method === "POST") {
    const body = await readBody(req);
    const ref =
      path === "/api/me/wishlist/manual"
        ? { manual: body }
        : { bookId: optionalNumber(body.book_id), olKey: body.ol_key, year: optionalNumber(body.year) };
    const r = await core.addToWishlist(db, user.id, ref, {
      owned: !!body.owned,
      isPublic: body.public,
      rank: optionalNumber(body.rank),
    });
    if (!r.ok) return failure(r);
    return json({ book: r.book, books: await core.listWishlist(db, user.id) });
  }
  if (path === "/api/me/wishlist/reorder" && method === "POST") {
    const { ordered } = await readBody(req);
    await core.reorderList(db, "wishlist", user.id, Array.isArray(ordered) ? ordered.map(Number) : []);
    return json({ books: await core.listWishlist(db, user.id) });
  }
  const wishMove = path.match(/^\/api\/me\/wishlist\/(\d+)\/move-to-read$/);
  if (wishMove && method === "POST") {
    const { review, rank, category_ids } = await readBody(req);
    const bookId = Number(wishMove[1]);
    const r = await core.moveToRead(db, user.id, bookId, { review, rank: optionalNumber(rank) });
    if (!r.ok) return failure(r);
    if (category_ids) await core.setBookCategories(db, user.id, bookId, idList(category_ids));
    return json({ ok: true, ...(await lists()) });
  }
  const wishOwned = path.match(/^\/api\/me\/wishlist\/(\d+)\/owned$/);
  if (wishOwned && method === "POST") {
    const { owned } = await readBody(req);
    const r = await core.setOwned(db, user.id, Number(wishOwned[1]), !!owned);
    if (!r.ok) return failure(r);
    return json({ books: await core.listWishlist(db, user.id) });
  }
  const wishMatch = path.match(/^\/api\/me\/wishlist\/(\d+)$/);
  if (wishMatch && method === "DELETE") {
    await core.removeFromWishlist(db, user.id, Number(wishMatch[1]));
    return json({ books: await core.listWishlist(db, user.id) });
  }

  // ----- currently reading -----
  if (path === "/api/me/reading" && method === "GET") return json({ books: await core.listReading(db, user.id) });
  if ((path === "/api/me/reading" || path === "/api/me/reading/manual") && method === "POST") {
    const body = await readBody(req);
    const ref =
      path === "/api/me/reading/manual"
        ? { manual: body }
        : { bookId: optionalNumber(body.book_id), olKey: body.ol_key, year: optionalNumber(body.year) };
    const r = await core.addToReading(db, user.id, ref);
    if (!r.ok) return failure(r);
    return json({ book: r.book, books: await core.listReading(db, user.id) });
  }
  if (path === "/api/me/reading/from-wishlist" && method === "POST") {
    const { book_id } = await readBody(req);
    const r = await core.moveFromWishlistToReading(db, user.id, Number(book_id));
    if (!r.ok) return failure(r);
    return json({ book: r.book, ...(await lists()) });
  }
  const readingFinish = path.match(/^\/api\/me\/reading\/(\d+)\/finish$/);
  if (readingFinish && method === "POST") {
    const { review, rank, category_ids } = await readBody(req);
    const bookId = Number(readingFinish[1]);
    const r = await core.finishReading(db, user.id, bookId, { review, rank: optionalNumber(rank) });
    if (!r.ok) return failure(r);
    if (category_ids) await core.setBookCategories(db, user.id, bookId, idList(category_ids));
    return json({ ok: true, ...(await lists()) });
  }
  const readingListening = path.match(/^\/api\/me\/reading\/(\d+)\/listening$/);
  if (readingListening && method === "POST") {
    const body = await readBody(req);
    const r = await core.setListening(db, user.id, Number(readingListening[1]), !!body.listening);
    if (!r.ok) return failure(r);
    return json({ books: await core.listReading(db, user.id) });
  }
  const readingBack = path.match(/^\/api\/me\/reading\/(\d+)\/back-to-wishlist$/);
  if (readingBack && method === "POST") {
    const r = await core.backToWishlist(db, user.id, Number(readingBack[1]));
    if (!r.ok) return failure(r);
    return json({ ok: true, ...(await lists()) });
  }
  const readingMatch = path.match(/^\/api\/me\/reading\/(\d+)$/);
  if (readingMatch && method === "DELETE") {
    await core.removeFromReading(db, user.id, Number(readingMatch[1]));
    return json({ ok: true, ...(await lists()) });
  }

  // ----- users & friends -----
  if (path === "/api/users/discover" && method === "GET") {
    return json({ users: await core.discoverUsers(db, user.id, (url.searchParams.get("q") ?? "").trim()) });
  }
  if (path === "/api/friends" && method === "GET") {
    return json({ friends: await core.listFriendsWithReading(db, user.id) });
  }
  if (path === "/api/friends/requests" && method === "GET") return json(await core.listFriendRequests(db, user.id));
  if (path === "/api/friends/requests" && method === "POST") {
    const { usernameOrEmail } = await readBody(req);
    const r = await core.sendFriendRequest(db, user.id, usernameOrEmail);
    return r.ok ? json(r) : failure(r);
  }
  const requestAction = path.match(/^\/api\/friends\/requests\/(\d+)\/(accept|decline)$/);
  if (requestAction && method === "POST") {
    const id = Number(requestAction[1]);
    const r =
      requestAction[2] === "accept"
        ? await core.acceptFriendRequest(db, user.id, id)
        : await core.declineFriendRequest(db, user.id, id);
    return r.ok ? json(r) : failure(r);
  }
  const friendList = path.match(/^\/api\/friends\/([^/]+)\/(books|wishlist|reading)$/);
  if (friendList && method === "GET") {
    const list = friendList[2] as core.FriendList;
    const r = await core.getFriendList(db, user.id, decodeURIComponent(friendList[1]), list);
    if (!r.ok) return failure(r);
    return json({
      user: r.user,
      books: r.books,
      categories: list === "books" ? await core.listCategories(db, r.user.id, true) : undefined,
    });
  }
  const unfriend = path.match(/^\/api\/friends\/(\d+)$/);
  if (unfriend && method === "DELETE") {
    await core.removeFriend(db, user.id, Number(unfriend[1]));
    return json({ friends: await core.listFriends(db, user.id) });
  }

  // ----- clubs -----
  if (path === "/api/clubs" && method === "GET") return json(await core.listClubsForUser(db, user.id));
  if (path === "/api/clubs" && method === "POST") {
    const { name, description, usernames } = await readBody(req);
    const r = await core.createClub(
      db,
      user.id,
      name,
      description,
      Array.isArray(usernames) ? usernames.map(String) : [],
    );
    return r.ok ? json({ club: r.club, invited: r.invited, skipped: r.skipped }) : failure(r);
  }

  const clubAction = path.match(/^\/api\/clubs\/(\d+)(?:\/([a-z-]+))?(?:\/(\d+))?$/);
  if (clubAction) {
    const clubId = Number(clubAction[1]);
    const action = `${method} ${clubAction[2] ?? ""}${clubAction[3] ? "/:id" : ""}`;
    const targetId = Number(clubAction[3]);

    if (action === "GET ") {
      const r = await core.getClub(db, user.id, clubId);
      return r.ok ? json({ club: r.club }) : failure(r);
    }
    if (action === "GET results/:id") {
      const r = await core.getClubResults(db, user.id, clubId, targetId);
      return r.ok ? json({ results: { voters: r.voters, nominations: r.nominations } }) : failure(r);
    }
    if (action === "GET events") {
      // Must be a member before we hold a stream open for them.
      const r = await core.getClub(db, user.id, clubId);
      return r.ok ? clubEvents(db, req, user.id, clubId, r.club) : failure(r);
    }
    if (action === "POST close-vote") {
      const r = await core.closeVote(db, user.id, clubId);
      if (r.ok) return await clubResponse(clubId);
      const runoff = "runoffNeeded" in r ? { runoffNeeded: true, runoffTitles: r.runoffTitles } : {};
      return json({ error: r.error, ...runoff }, r.status);
    }

    // Leaving changes which clubs you're in; everything else changes this club's page.
    const body = method === "POST" ? await readBody(req) : {};
    const exits: Record<string, () => Promise<core.Result>> = {
      "POST respond": () => core.respondToClubInvite(db, user.id, clubId, !!body.accept),
      "POST leave": () => core.leaveClub(db, user.id, clubId),
      "POST transfer": () => core.transferClubOwnership(db, user.id, clubId, Number(body.userId)),
      "DELETE ": () => core.deleteClub(db, user.id, clubId),
    };
    const changes: Record<string, () => Promise<core.Result>> = {
      "POST invite": () => core.inviteToClub(db, user.id, clubId, body.username),
      "POST nominate": () =>
        core.nominateBook(db, user.id, clubId, {
          olKey: body.ol_key,
          bookId: optionalNumber(body.book_id),
          year: optionalNumber(body.year),
        }),
      "POST vote": () => core.castBallot(db, user.id, clubId, idList(body.ballot)),
      "POST veto": () => core.vetoNomination(db, user.id, clubId, Number(body.nominationId)),
      "POST runoff": () => core.startRunoff(db, user.id, clubId),
      "POST open-nominations": () => core.openNominations(db, user.id, clubId),
      "POST start-voting": () => core.startVoting(db, user.id, clubId),
      "POST back-to-nominations": () => core.backToNominations(db, user.id, clubId),
      "DELETE members/:id": () => core.removeClubMember(db, user.id, clubId, targetId),
      "DELETE nominations/:id": () => core.removeNomination(db, user.id, clubId, targetId),
    };
    const exit = exits[action];
    if (exit) {
      const r = await exit();
      if (!r.ok) return failure(r);
      return action === "POST respond" || action === "POST leave" ? await clubsResponse() : json({ ok: true });
    }
    const change = changes[action];
    if (change) {
      const r = await change();
      return r.ok ? await clubResponse(clubId) : failure(r);
    }
  }

  // ----- notifications -----
  if (path === "/api/notifications" && method === "GET") return json(await core.getNotifications(db, user.id));
  if (path === "/api/notifications/seen" && method === "POST") {
    await core.markInformationalNotificationsRead(db, user.id);
    return json(await core.getNotifications(db, user.id));
  }

  // ----- admin -----
  const adminRoute =
    path === "/api/admin/cleanup-rejected" ||
    path === "/api/books/backfill-synopses" ||
    /^\/api\/users\/\d+\/(approve|reject)$/.test(path);
  if (adminRoute && method === "POST") {
    if (!user.is_admin) return json({ error: "Unauthorized" }, 403);
    if (path === "/api/admin/cleanup-rejected") return json({ ok: true, ...(await core.cleanupRejectedUsers(db)) });
    if (path === "/api/books/backfill-synopses") return json(await core.backfillSynopses(db));
    const [, , , id, decision] = path.split("/");
    if (decision === "approve") await core.approveUser(db, Number(id));
    else await core.rejectUser(db, Number(id));
    // Every admin's copy of the signup alert is handled now.
    await core.markNotificationsRead(db, "new_user_signup", "id", Number(id));
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}
