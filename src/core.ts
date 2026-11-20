import { queryOne, queryAll, execute, now } from "./db";
import { fetchWork, type OLWork } from "./ol";

export interface User {
  id: number;
  username: string;
  email: string;
  is_admin: number;
  status: 'pending' | 'approved' | 'rejected';
  book_limit: number;
  rejected_at: number | null;
  discoverable: number;
}

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  return await queryOne<User>(db, "SELECT id, username, email, is_admin, status, book_limit, rejected_at, discoverable FROM users WHERE id = ?", id);
}

export async function findUser(db: D1Database, identifier: string): Promise<(User & { password_hash: string }) | null> {
  return await queryOne<User & { password_hash: string }>(
    db,
    "SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE",
    identifier, identifier
  );
}

export async function createUser(db: D1Database, username: string, email: string, passwordHash: string): Promise<User> {
  await execute(db, "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)", username, email, passwordHash);
  return (await queryOne<User>(db, "SELECT id, username, email FROM users WHERE username = ?", username))!;
}

export async function usernameExists(db: D1Database, username: string): Promise<boolean> {
  return !!(await queryOne(db, "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", username));
}

export async function emailExists(db: D1Database, email: string): Promise<boolean> {
  return !!(await queryOne(db, "SELECT 1 FROM users WHERE email = ? COLLATE NOCASE", email));
}

export async function searchUsers(db: D1Database, query: string, excludeId: number, limit = 20): Promise<{ id: number; username: string }[]> {
  const like = `%${query}%`;
  return await queryAll<{ id: number; username: string }>(
    db,
    "SELECT id, username FROM users WHERE id != ? AND discoverable = 1 AND (username LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE) ORDER BY username LIMIT ?",
    excludeId, like, like, limit
  );
}

export async function discoverUsers(db: D1Database, excludeId: number, limit = 50): Promise<{ id: number; username: string }[]> {
  return await queryAll<{ id: number; username: string }>(
    db,
    "SELECT id, username FROM users WHERE id != ? AND discoverable = 1 ORDER BY username LIMIT ?",
    excludeId, limit
  );
}

export async function setDiscoverable(db: D1Database, userId: number, discoverable: boolean): Promise<void> {
  await execute(db, "UPDATE users SET discoverable = ? WHERE id = ?", discoverable ? 1 : 0, userId);
}

export async function getDiscoverable(db: D1Database, userId: number): Promise<boolean> {
  const r = await queryOne<{ discoverable: number }>(db, "SELECT discoverable FROM users WHERE id = ?", userId);
  return r?.discoverable === 1;
}

// ---------- Books ----------

export interface BookRow {
  id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  synopsis: string | null;
}

export interface ReadRow extends BookRow {
  book_id: number;
  rank: number;
  review: string | null;
  public: number;
  created_at: number;
  updated_at: number;
}

export async function getBookByOlKey(db: D1Database, key: string): Promise<BookRow | null> {
  return await queryOne<BookRow>(db, "SELECT * FROM books WHERE ol_key = ?", key);
}

export async function getExistingBookKeys(db: D1Database, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const placeholders = keys.map(() => "?").join(",");
  const rows = await queryAll<{ ol_key: string }>(
    db,
    `SELECT ol_key FROM books WHERE ol_key IN (${placeholders})`,
    ...keys
  );
  return new Set(rows.map(r => r.ol_key));
}

export async function getBookById(db: D1Database, id: number): Promise<BookRow | null> {
  return await queryOne<BookRow>(db, "SELECT * FROM books WHERE id = ?", id);
}

export interface MyBookHit {
  bookId: number;
  key: string;
  title: string;
  author: string;
  coverUrl?: string;
  year?: number;
  list: "reading" | "wishlist" | "read";
}

// Books from the user's own lists (reading, wishlist, read) whose title or
// author matches the query. Club nomination search uses this so members can
// nominate straight from their shelves. A book on several lists appears once,
// preferring reading over wishlist over read.
export async function searchMyBooks(db: D1Database, userId: number, q: string): Promise<MyBookHit[]> {
  const like = `%${q}%`;
  const rows = await queryAll<{
    id: number; ol_key: string; title: string; author: string | null;
    cover_url: string | null; first_publish_year: number | null; list: string;
  }>(
    db,
    `SELECT b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, x.list
     FROM books b
     JOIN (
       SELECT book_id, 'reading' AS list, 0 AS ord FROM reading WHERE user_id = ?
       UNION ALL
       SELECT book_id, 'wishlist' AS list, 1 AS ord FROM wishlist WHERE user_id = ?
       UNION ALL
       SELECT book_id, 'read' AS list, 2 AS ord FROM reads WHERE user_id = ?
     ) x ON x.book_id = b.id
     WHERE b.title LIKE ? OR b.author LIKE ?
     ORDER BY x.ord ASC`,
    userId, userId, userId, like, like
  );
  const seen = new Set<number>();
  const hits: MyBookHit[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    hits.push({
      bookId: r.id,
      key: r.ol_key,
      title: r.title,
      author: r.author ?? "",
      coverUrl: r.cover_url ?? undefined,
      year: r.first_publish_year ?? undefined,
      list: r.list as MyBookHit["list"],
    });
  }
  return hits;
}

export async function setBookCover(db: D1Database, id: number, coverUrl: string): Promise<BookRow | null> {
  await execute(db, "UPDATE books SET cover_url = ? WHERE id = ?", coverUrl, id);
  return await getBookById(db, id);
}

async function insertBook(db: D1Database, w: OLWork, yearHint?: number): Promise<BookRow> {
  await execute(
    db,
    "INSERT INTO books (ol_key, title, author, cover_url, first_publish_year, synopsis) VALUES (?, ?, ?, ?, ?, ?)",
    w.key, w.title, w.author || null, w.coverUrl || null, yearHint ?? w.year ?? null, w.synopsis ?? null
  );
  return (await getBookByOlKey(db, w.key))!;
}

export async function getOrCreateBookByKey(db: D1Database, olKey: string, yearHint?: number): Promise<BookRow | null> {
  const existing = await getBookByOlKey(db, olKey);
  if (existing) {
    if (!existing.first_publish_year && yearHint) {
      await execute(db, "UPDATE books SET first_publish_year = ? WHERE id = ?", yearHint, existing.id);
      return await getBookById(db, existing.id);
    }
    return existing;
  }
  const w = await fetchWork(olKey);
  if (!w) return null;
  return await insertBook(db, w, yearHint);
}

// ---------- Reads (a user's ranked list) ----------

export async function listReads(db: D1Database, userId: number, publicOnly = false): Promise<ReadRow[]> {
  const pub = publicOnly ? "AND r.public = 1" : "";
  return await queryAll<ReadRow>(
    db,
    `SELECT r.book_id, r.rank, r.review, r.public, r.created_at, r.updated_at,
           b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis
    FROM reads r JOIN books b ON b.id = r.book_id
    WHERE r.user_id = ? ${pub} ORDER BY r.rank ASC`,
    userId
  );
}

async function insertReadEntry(
  db: D1Database,
  userId: number,
  bookId: number,
  review?: string,
  rank?: number,
  isPublic?: boolean
): Promise<{ ok: boolean; error?: string }> {
  const existing = await queryOne(db, "SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (existing) return { ok: false, error: "This book is already on your list" };

  const max = await queryOne<{ m: number }>(db, "SELECT COALESCE(MAX(rank), 0) AS m FROM reads WHERE user_id = ?", userId);
  const maxRank: number = max?.m ?? 0;
  let r: number;
  if (rank == null) r = maxRank + 1;
  else r = Math.min(Math.max(Math.round(rank), 1), maxRank + 1);

  // Use batch for transaction-like behavior
  const statements: D1PreparedStatement[] = [];
  if (rank != null) {
    statements.push(db.prepare("UPDATE reads SET rank = rank + 1 WHERE user_id = ? AND rank >= ?").bind(userId, r));
  }
  statements.push(
    db.prepare("INSERT INTO reads (user_id, book_id, rank, review, public) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, bookId, r, review ?? null, isPublic === false ? 0 : 1)
  );
  await db.batch(statements);

  return { ok: true };
}

export async function addRead(
  db: D1Database,
  userId: number,
  olKey?: string,
  review?: string,
  rank?: number,
  year?: number,
  isPublic?: boolean
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  if (!olKey) return { ok: false, error: "ol_key is required" };
  const book = await getOrCreateBookByKey(db, olKey, year);
  if (!book) return { ok: false, error: "Could not load book from Open Library" };

  const r = await insertReadEntry(db, userId, book.id, review, rank, isPublic);
  if (r.error) return { ok: false, error: r.error };

  return { ok: true, book };
}

export interface ManualBookFields {
  title?: string;
  author?: string;
  year?: number;
  coverUrl?: string;
}

export async function createManualBook(db: D1Database, fields: ManualBookFields): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  const title = typeof fields?.title === "string" ? fields.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required" };

  const author = typeof fields.author === "string" && fields.author.trim() ? fields.author.trim() : null;
  const coverUrl = typeof fields.coverUrl === "string" && fields.coverUrl.trim() ? fields.coverUrl.trim() : null;
  const year = typeof fields.year === "number" && Number.isFinite(fields.year) ? Math.round(fields.year) : null;

  const olKey = "manual:" + crypto.randomUUID();
  await execute(
    db,
    "INSERT INTO books (ol_key, title, author, cover_url, first_publish_year, manual) VALUES (?, ?, ?, ?, ?, 1)",
    olKey, title, author, coverUrl, year
  );

  return { ok: true, book: (await getBookByOlKey(db, olKey))! };
}

export async function addManualBook(
  db: D1Database,
  userId: number,
  fields: ManualBookFields,
  review?: string,
  rank?: number,
  isPublic?: boolean
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  const c = await createManualBook(db, fields);
  if (c.error || !c.book) return { ok: false, error: c.error };
  const r = await insertReadEntry(db, userId, c.book.id, review, rank, isPublic);
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, book: c.book };
}

// ---------- Wishlist ----------

export interface WishlistRow extends BookRow {
  book_id: number;
  owned: number;
  public: number;
  rank: number;
  created_at: number;
}

export async function listWishlist(db: D1Database, userId: number, publicOnly = false): Promise<WishlistRow[]> {
  const pub = publicOnly ? "AND w.public = 1" : "";
  return await queryAll<WishlistRow>(
    db,
    `SELECT w.book_id, w.owned, w.public, w.rank, w.created_at,
           b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis
    FROM wishlist w JOIN books b ON b.id = w.book_id
    WHERE w.user_id = ? ${pub} ORDER BY w.rank ASC`,
    userId
  );
}

export interface NextUpRow extends WishlistRow {
  reason: "owned" | "friend";
  friendUsername?: string;
}

export async function getNextUp(db: D1Database, userId: number, limit = 1): Promise<NextUpRow[]> {
  const owned = await queryAll<WishlistRow>(
    db,
    `SELECT w.book_id, w.owned, w.public, w.rank, w.created_at,
           b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis
    FROM wishlist w JOIN books b ON b.id = w.book_id
    WHERE w.user_id = ? AND w.owned = 1
    ORDER BY w.rank ASC`,
    userId
  );

  const friends = await listFriends(db, userId);
  const friendOwned: (WishlistRow & { friendUsername: string })[] = [];
  const seen = new Set<number>();

  if (friends.length > 0) {
    const placeholders = friends.map(() => "?").join(",");
    const friendIds = friends.map((f) => f.user_id);
    const rows = await queryAll<WishlistRow & { friend_user_id: number }>(
      db,
      `SELECT w.book_id, w.owned, w.public, w.rank, w.created_at,
              b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis,
              r.user_id AS friend_user_id
       FROM wishlist w
       JOIN books b ON b.id = w.book_id
       JOIN reads r ON r.book_id = w.book_id
       WHERE w.user_id = ? AND r.user_id IN (${placeholders})
       ORDER BY w.rank ASC`,
      userId, ...friendIds
    );

    const friendById = new Map(friends.map((f) => [f.user_id, f.username]));
    for (const row of rows) {
      if (seen.has(row.book_id)) continue;
      seen.add(row.book_id);
      friendOwned.push({ ...row, friendUsername: friendById.get(row.friend_user_id) || "" });
    }
  }

  const combined: NextUpRow[] = [];
  const combinedIds = new Set<number>();
  for (const row of owned) {
    if (combined.length >= limit) break;
    if (combinedIds.has(row.book_id)) continue;
    combinedIds.add(row.book_id);
    combined.push({ ...row, reason: "owned" });
  }
  for (const row of friendOwned) {
    if (combined.length >= limit) break;
    if (combinedIds.has(row.book_id)) continue;
    combinedIds.add(row.book_id);
    combined.push({ ...row, reason: "friend", friendUsername: row.friendUsername });
  }

  if (combined.length === 0) {
    const top = (await listWishlist(db, userId)).slice(0, limit);
    for (const row of top) {
      combined.push({ ...row, reason: "owned" });
    }
  }

  return combined;
}

async function wishOrderedIds(db: D1Database, userId: number): Promise<number[]> {
  const rows = await queryAll<{ book_id: number }>(
    db,
    "SELECT book_id FROM wishlist WHERE user_id = ? ORDER BY rank ASC, book_id ASC",
    userId
  );
  return rows.map((r) => r.book_id);
}

export async function reorderWishlist(db: D1Database, userId: number, orderedBookIds: number[]): Promise<void> {
  const current = await wishOrderedIds(db, userId);
  const currentSet = new Set(current);
  const given: number[] = [];
  for (const id of orderedBookIds) {
    if (currentSet.has(id) && !given.includes(id)) given.push(id);
  }
  const givenSet = new Set(given);
  const remainder = current.filter((id) => !givenSet.has(id));
  const finalOrder = [...given, ...remainder];

  const statements = finalOrder.map((id, i) =>
    db.prepare("UPDATE wishlist SET rank = ? WHERE user_id = ? AND book_id = ?").bind(i + 1, userId, id)
  );
  await db.batch(statements);
}

export async function addToWishlistByOlKey(
  db: D1Database,
  userId: number,
  olKey?: string,
  owned?: boolean,
  year?: number,
  isPublic?: boolean,
  rank?: number
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  if (!olKey) return { ok: false, error: "ol_key is required" };
  const book = await getOrCreateBookByKey(db, olKey, year);
  if (!book) return { ok: false, error: "Could not load book from Open Library" };
  const r = await addToWishlist(db, userId, book.id, owned, isPublic, rank);
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, book };
}

export async function addToWishlist(
  db: D1Database,
  userId: number,
  bookId: number,
  owned?: boolean,
  isPublic?: boolean,
  rank?: number
): Promise<{ ok: boolean; error?: string }> {
  const existing = await queryOne(db, "SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (existing) return { ok: false, error: "Already on your wishlist" };

  const max = await queryOne<{ m: number }>(db, "SELECT COALESCE(MAX(rank), 0) AS m FROM wishlist WHERE user_id = ?", userId);
  const maxRank: number = max?.m ?? 0;
  let r: number;
  if (rank == null) r = maxRank + 1;
  else r = Math.min(Math.max(Math.round(rank), 1), maxRank + 1);

  const statements: D1PreparedStatement[] = [];
  if (rank != null) {
    statements.push(db.prepare("UPDATE wishlist SET rank = rank + 1 WHERE user_id = ? AND rank >= ?").bind(userId, r));
  }
  statements.push(
    db.prepare("INSERT INTO wishlist (user_id, book_id, owned, public, rank) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, bookId, owned ? 1 : 0, isPublic ? 1 : 0, r)
  );
  await db.batch(statements);

  return { ok: true };
}

export async function addToWishlistByBookId(
  db: D1Database,
  userId: number,
  bookId: number,
  owned?: boolean,
  isPublic?: boolean,
  rank?: number
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  const book = await getBookById(db, bookId);
  if (!book) return { ok: false, error: "Book not found" };
  const existing = await queryOne(db, "SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (existing) return { ok: false, error: "You've already read this — it's on your books list" };
  const r = await addToWishlist(db, userId, bookId, owned, isPublic, rank);
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, book };
}

export async function removeFromWishlist(db: D1Database, userId: number, bookId: number): Promise<void> {
  await execute(db, "DELETE FROM wishlist WHERE user_id = ? AND book_id = ?", userId, bookId);
  const ids = await wishOrderedIds(db, userId);
  await reorderWishlist(db, userId, ids);
}

export async function setOwned(db: D1Database, userId: number, bookId: number, owned: boolean): Promise<{ ok: boolean; error?: string }> {
  const existing = await queryOne(db, "SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (!existing) return { ok: false, error: "Not on your wishlist" };
  await execute(db, "UPDATE wishlist SET owned = ? WHERE user_id = ? AND book_id = ?", owned ? 1 : 0, userId, bookId);
  return { ok: true };
}

export async function setReadPublic(db: D1Database, userId: number, bookId: number, isPublic: boolean): Promise<{ ok: boolean; error?: string }> {
  const row = await queryOne(db, "SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (!row) return { ok: false, error: "Book not on your list" };
  await execute(db, "UPDATE reads SET public = ? WHERE user_id = ? AND book_id = ?", isPublic ? 1 : 0, userId, bookId);
  return { ok: true };
}

export async function setWishPublic(db: D1Database, userId: number, bookId: number, isPublic: boolean): Promise<{ ok: boolean; error?: string }> {
  const row = await queryOne(db, "SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (!row) return { ok: false, error: "Not on your wishlist" };
  await execute(db, "UPDATE wishlist SET public = ? WHERE user_id = ? AND book_id = ?", isPublic ? 1 : 0, userId, bookId);
  return { ok: true };
}

export async function moveToRead(
  db: D1Database,
  userId: number,
  bookId: number,
  review?: string,
  rank?: number
): Promise<{ ok: boolean; error?: string }> {
  const wish = await queryOne<{ public: number }>(
    db,
    "SELECT public FROM wishlist WHERE user_id = ? AND book_id = ?",
    userId, bookId
  );
  if (!wish) return { ok: false, error: "Not on your wishlist" };

  const alreadyRead = await queryOne(db, "SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (alreadyRead) {
    await removeFromWishlist(db, userId, bookId);
    return { ok: true };
  }

  const r = await insertReadEntry(db, userId, bookId, review, rank, (wish.public ?? 0) === 1);
  if (r.error) return { ok: false, error: r.error };
  await removeFromWishlist(db, userId, bookId);
  return { ok: true };
}

export async function addManualToWishlist(
  db: D1Database,
  userId: number,
  fields: ManualBookFields,
  owned?: boolean,
  isPublic?: boolean,
  rank?: number
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  const c = await createManualBook(db, fields);
  if (c.error || !c.book) return { ok: false, error: c.error };
  const r = await addToWishlist(db, userId, c.book.id, owned, isPublic, rank);
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, book: c.book };
}

export async function setReview(db: D1Database, userId: number, bookId: number, review: string): Promise<{ ok: boolean; error?: string }> {
  const row = await queryOne(db, "SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (!row) return { ok: false, error: "Book not on your list" };
  await execute(db, "UPDATE reads SET review = ?, updated_at = ? WHERE user_id = ? AND book_id = ?", review, now(), userId, bookId);
  return { ok: true };
}

export async function reorderReads(db: D1Database, userId: number, orderedBookIds: number[]): Promise<void> {
  const currentRaw = await queryAll<{ book_id: number }>(
    db,
    "SELECT book_id FROM reads WHERE user_id = ? ORDER BY rank ASC",
    userId
  );
  const current = currentRaw.map((r) => r.book_id);
  const currentSet = new Set(current);

  const given: number[] = [];
  for (const id of orderedBookIds) {
    if (currentSet.has(id) && !given.includes(id)) given.push(id);
  }
  const givenSet = new Set(given);
  const remainder = current.filter((id) => !givenSet.has(id));
  const finalOrder = [...given, ...remainder];

  const statements = finalOrder.map((id, i) =>
    db.prepare("UPDATE reads SET rank = ?, updated_at = ? WHERE user_id = ? AND book_id = ?")
      .bind(i + 1, now(), userId, id)
  );
  await db.batch(statements);
}

export async function setRank(db: D1Database, userId: number, bookId: number, newRank: number): Promise<{ ok: boolean; error?: string }> {
  const currentRaw = await queryAll<{ book_id: number }>(
    db,
    "SELECT book_id FROM reads WHERE user_id = ? ORDER BY rank ASC",
    userId
  );
  const ids = currentRaw.map((r) => r.book_id);
  const idx = ids.indexOf(bookId);
  if (idx < 0) return { ok: false, error: "Book not on your list" };
  ids.splice(idx, 1);
  const insertAt = Math.max(0, Math.min(newRank - 1, ids.length));
  ids.splice(insertAt, 0, bookId);
  await reorderReads(db, userId, ids);
  return { ok: true };
}

export async function removeRead(db: D1Database, userId: number, bookId: number): Promise<{ ok: boolean }> {
  await execute(db, "DELETE FROM reads WHERE user_id = ? AND book_id = ?", userId, bookId);
  const remaining = await queryAll<{ book_id: number }>(
    db,
    "SELECT book_id FROM reads WHERE user_id = ? ORDER BY rank ASC",
    userId
  );
  await reorderReads(db, userId, remaining.map((r) => r.book_id));
  return { ok: true };
}

// ---------- Currently reading ----------

export interface ReadingRow extends BookRow {
  book_id: number;
  created_at: number;
}

export async function listReading(db: D1Database, userId: number): Promise<ReadingRow[]> {
  return await queryAll<ReadingRow>(
    db,
    `SELECT r.book_id, r.created_at,
           b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis
    FROM reading r JOIN books b ON b.id = r.book_id
    WHERE r.user_id = ? ORDER BY r.created_at DESC, r.book_id DESC`,
    userId
  );
}

export async function addToReadingByBookId(
  db: D1Database,
  userId: number,
  bookId: number,
  wishlistState?: { rank: number; owned: number; public: number }
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  const book = await getBookById(db, bookId);
  if (!book) return { ok: false, error: "Book not found" };
  const existing = await queryOne(db, "SELECT 1 FROM reading WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (existing) return { ok: false, error: "Already currently reading" };
  if (wishlistState) {
    await execute(
      db,
      "INSERT INTO reading (user_id, book_id, wishlist_rank, wishlist_owned, wishlist_public) VALUES (?, ?, ?, ?, ?)",
      userId, bookId, wishlistState.rank, wishlistState.owned, wishlistState.public
    );
  } else {
    await execute(db, "INSERT INTO reading (user_id, book_id) VALUES (?, ?)", userId, bookId);
  }
  return { ok: true, book };
}

export async function moveFromWishlistToReading(
  db: D1Database,
  userId: number,
  bookId: number
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  const wishItem = await queryOne<{ rank: number; owned: number; public: number }>(
    db,
    "SELECT rank, owned, public FROM wishlist WHERE user_id = ? AND book_id = ?",
    userId, bookId
  );
  if (!wishItem) return { ok: false, error: "Book not on your wishlist" };

  const r = await addToReadingByBookId(db, userId, bookId, wishItem);
  if (r.error) return r;

  await removeFromWishlist(db, userId, bookId);
  return r;
}

export async function addToReadingByOlKey(
  db: D1Database,
  userId: number,
  olKey?: string,
  year?: number
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  if (!olKey) return { ok: false, error: "ol_key is required" };
  const book = await getOrCreateBookByKey(db, olKey, year);
  if (!book) return { ok: false, error: "Could not load book from Open Library" };
  return await addToReadingByBookId(db, userId, book.id);
}

export async function addManualToReading(
  db: D1Database,
  userId: number,
  fields: ManualBookFields
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  const c = await createManualBook(db, fields);
  if (c.error || !c.book) return { ok: false, error: c.error };
  return await addToReadingByBookId(db, userId, c.book.id);
}

export async function removeFromReading(db: D1Database, userId: number, bookId: number, skipWishlistRestore = false): Promise<void> {
  const reading = await queryOne<{ wishlist_rank: number | null; wishlist_owned: number | null; wishlist_public: number | null }>(
    db,
    "SELECT wishlist_rank, wishlist_owned, wishlist_public FROM reading WHERE user_id = ? AND book_id = ?",
    userId, bookId
  );

  await execute(db, "DELETE FROM reading WHERE user_id = ? AND book_id = ?", userId, bookId);

  if (!skipWishlistRestore && reading && reading.wishlist_rank != null) {
    const onWishlist = await queryOne(db, "SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?", userId, bookId);
    if (!onWishlist) {
      await execute(db, "UPDATE wishlist SET rank = rank + 1 WHERE user_id = ? AND rank >= ?", userId, reading.wishlist_rank);
      await execute(
        db,
        "INSERT INTO wishlist (user_id, book_id, rank, owned, public) VALUES (?, ?, ?, ?, ?)",
        userId, bookId, reading.wishlist_rank, reading.wishlist_owned || 0, reading.wishlist_public || 0
      );
    }
  }
}

export async function finishReading(
  db: D1Database,
  userId: number,
  bookId: number,
  review?: string,
  rank?: number
): Promise<{ ok: boolean; error?: string }> {
  const cur = await queryOne(db, "SELECT 1 FROM reading WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (!cur) return { ok: false, error: "Not currently reading" };
  const alreadyRead = await queryOne(db, "SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?", userId, bookId);
  if (!alreadyRead) {
    const r = await insertReadEntry(db, userId, bookId, review, rank);
    if (r.error) return { ok: false, error: r.error };
  }
  await removeFromReading(db, userId, bookId, true);
  return { ok: true };
}

export async function backToWishlist(db: D1Database, userId: number, bookId: number): Promise<{ ok: boolean; error?: string }> {
  const cur = await queryOne<{ wishlist_rank: number | null; wishlist_owned: number | null; wishlist_public: number | null }>(
    db,
    "SELECT wishlist_rank, wishlist_owned, wishlist_public FROM reading WHERE user_id = ? AND book_id = ?",
    userId, bookId
  );
  if (!cur) return { ok: false, error: "Not currently reading" };

  const onWishlist = await queryOne(db, "SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?", userId, bookId);

  if (!onWishlist) {
    if (cur.wishlist_rank != null) {
      await execute(db, "UPDATE wishlist SET rank = rank + 1 WHERE user_id = ? AND rank >= ?", userId, cur.wishlist_rank);
      await execute(
        db,
        "INSERT INTO wishlist (user_id, book_id, rank, owned, public) VALUES (?, ?, ?, ?, ?)",
        userId, bookId, cur.wishlist_rank, cur.wishlist_owned || 0, cur.wishlist_public || 0
      );
    } else {
      const r = await addToWishlist(db, userId, bookId, false, false);
      if (r.error) return { ok: false, error: r.error };
    }
  }

  await removeFromReading(db, userId, bookId, true);
  return { ok: true };
}

// ---------- Friends ----------

export interface FriendRequestRow {
  id: number;
  user_id: number;
  username: string;
}

export async function sendFriendRequest(
  db: D1Database,
  requesterId: number,
  identifier: string
): Promise<{ ok: boolean; error?: string; username?: string; autoAccepted?: boolean }> {
  const target = await findUser(db, String(identifier).trim());
  if (!target) return { ok: false, error: "User not found" };
  if (target.id === requesterId) return { ok: false, error: "You can't add yourself" };

  const requester = await getUserById(db, requesterId);
  const requesterName = requester?.username ?? "Someone";

  const existing = await queryOne<any>(
    db,
    "SELECT * FROM friendships WHERE (requester_id = ? AND requestee_id = ?) OR (requester_id = ? AND requestee_id = ?)",
    requesterId, target.id, target.id, requesterId
  );

  if (existing) {
    if (existing.status === "accepted") return { ok: false, error: "You are already friends" };
    if (existing.requester_id === requesterId) return { ok: false, error: "Friend request already sent" };
    await execute(db, "UPDATE friendships SET status = 'accepted' WHERE id = ?", existing.id);
    // The pending request notification belongs to the current user (they received the original request)
    await dismissFriendRequestNotification(db, requesterId, existing.id);
    await createNotification(
      db,
      target.id,
      "friend_accepted",
      `@${requesterName} accepted your friend request`,
      { userId: requesterId, username: requesterName }
    );
    return { ok: true, autoAccepted: true, username: target.username };
  }

  await execute(db, "INSERT INTO friendships (requester_id, requestee_id, status) VALUES (?, ?, 'pending')", requesterId, target.id);
  const friendship = await queryOne<{ id: number }>(
    db,
    "SELECT id FROM friendships WHERE requester_id = ? AND requestee_id = ? AND status = 'pending'",
    requesterId, target.id
  );
  if (friendship) {
    await createNotification(
      db,
      target.id,
      "friend_request",
      `@${requesterName} sent you a friend request`,
      { requestId: friendship.id, userId: requesterId, username: requesterName }
    );
  }
  return { ok: true, username: target.username };
}

export async function listFriendRequests(db: D1Database, userId: number): Promise<{ incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] }> {
  const incoming = await queryAll<FriendRequestRow>(
    db,
    `SELECT f.id, u.id AS user_id, u.username
    FROM friendships f JOIN users u ON u.id = f.requester_id
    WHERE f.requestee_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC`,
    userId
  );
  const outgoing = await queryAll<FriendRequestRow>(
    db,
    `SELECT f.id, u.id AS user_id, u.username
    FROM friendships f JOIN users u ON u.id = f.requestee_id
    WHERE f.requester_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC`,
    userId
  );
  return { incoming, outgoing };
}

export async function acceptFriendRequest(db: D1Database, userId: number, requestId: number): Promise<{ ok: boolean; error?: string }> {
  const f = await queryOne<{ requester_id: number }>(db, "SELECT requester_id FROM friendships WHERE id = ? AND requestee_id = ? AND status = 'pending'", requestId, userId);
  if (!f) return { ok: false, error: "Request not found" };
  await execute(db, "UPDATE friendships SET status = 'accepted' WHERE id = ?", requestId);
  await dismissFriendRequestNotification(db, userId, requestId);
  const accepter = await getUserById(db, userId);
  if (accepter) {
    await createNotification(
      db,
      f.requester_id,
      "friend_accepted",
      `@${accepter.username} accepted your friend request`,
      { userId, username: accepter.username }
    );
  }
  return { ok: true };
}

export async function declineFriendRequest(db: D1Database, userId: number, requestId: number): Promise<{ ok: boolean; error?: string }> {
  await execute(db, "DELETE FROM friendships WHERE id = ? AND requestee_id = ? AND status = 'pending'", requestId, userId);
  await dismissFriendRequestNotification(db, userId, requestId);
  return { ok: true };
}

// Mark the friend_request notification for a handled request as read
async function dismissFriendRequestNotification(db: D1Database, userId: number, requestId: number): Promise<void> {
  await execute(
    db,
    "UPDATE notifications SET read = 1 WHERE user_id = ? AND type = 'friend_request' AND data LIKE ?",
    userId,
    `%"requestId":${requestId},%`
  );
}

export async function listFriends(db: D1Database, userId: number): Promise<{ user_id: number; username: string }[]> {
  return await queryAll<{ user_id: number; username: string }>(
    db,
    `SELECT u.id AS user_id, u.username
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.requestee_id ELSE f.requester_id END
    WHERE (f.requester_id = ? OR f.requestee_id = ?) AND f.status = 'accepted'
    ORDER BY u.username COLLATE NOCASE`,
    userId, userId, userId
  );
}

export interface FriendWithReading {
  user_id: number;
  username: string;
  reading: ReadingRow[];
}

export async function listFriendsWithReading(db: D1Database, userId: number): Promise<FriendWithReading[]> {
  const friends = await listFriends(db, userId);
  if (friends.length === 0) return [];
  const rows = await queryAll<ReadingRow & { user_id: number }>(
    db,
    `SELECT user_id, book_id, created_at, id, ol_key, title, author, cover_url, first_publish_year, manual, synopsis
     FROM (
       SELECT r.user_id, r.book_id, r.created_at,
              b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis,
              ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.created_at DESC, r.book_id DESC) AS rn
       FROM reading r JOIN books b ON b.id = r.book_id
       WHERE r.user_id IN (
         SELECT CASE WHEN f.requester_id = ? THEN f.requestee_id ELSE f.requester_id END
         FROM friendships f
         WHERE (f.requester_id = ? OR f.requestee_id = ?) AND f.status = 'accepted'
       )
     ) WHERE rn <= 2
     ORDER BY user_id, rn`,
    userId, userId, userId
  );
  const byUser = new Map<number, ReadingRow[]>();
  for (const { user_id, ...book } of rows) {
    const list = byUser.get(user_id) ?? [];
    list.push(book);
    byUser.set(user_id, list);
  }
  return friends.map((f) => ({ ...f, reading: byUser.get(f.user_id) ?? [] }));
}

export async function removeFriend(db: D1Database, userId: number, friendId: number): Promise<void> {
  await execute(
    db,
    "DELETE FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND requestee_id = ?) OR (requester_id = ? AND requestee_id = ?))",
    userId, friendId, friendId, userId
  );
}

export async function isFriend(db: D1Database, a: number, b: number): Promise<boolean> {
  return !!(await queryOne(
    db,
    "SELECT 1 FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND requestee_id = ?) OR (requester_id = ? AND requestee_id = ?))",
    a, b, b, a
  ));
}

type MineStatus = "read" | "wish" | "reading" | null;

async function viewerOwnership(db: D1Database, viewerId: number): Promise<{ reads: Set<number>; wish: Set<number>; reading: Set<number> }> {
  const reads = new Set(
    (await queryAll<{ book_id: number }>(db, "SELECT book_id FROM reads WHERE user_id = ?", viewerId)).map((r) => r.book_id)
  );
  const wish = new Set(
    (await queryAll<{ book_id: number }>(db, "SELECT book_id FROM wishlist WHERE user_id = ?", viewerId)).map((r) => r.book_id)
  );
  const reading = new Set(
    (await queryAll<{ book_id: number }>(db, "SELECT book_id FROM reading WHERE user_id = ?", viewerId)).map((r) => r.book_id)
  );
  return { reads, wish, reading };
}

function mineStatus(
  o: { reads: Set<number>; wish: Set<number>; reading: Set<number> },
  bookId: number
): MineStatus {
  return o.reading.has(bookId) ? "reading" : o.reads.has(bookId) ? "read" : o.wish.has(bookId) ? "wish" : null;
}

export async function getFriendReads(
  db: D1Database,
  viewerId: number,
  friendUsername: string
): Promise<{ ok: boolean; error?: string; user?: { id: number; username: string }; books?: ReadRow[] }> {
  const friend = await queryOne<{ id: number; username: string }>(
    db,
    "SELECT id, username FROM users WHERE username = ? COLLATE NOCASE",
    friendUsername
  );
  if (!friend) return { ok: false, error: "User not found" };
  if (friend.id === viewerId) return { ok: false, error: "That's you — use your own list" };
  if (!(await isFriend(db, viewerId, friend.id))) return { ok: false, error: "You are not friends with this user" };

  const mine = await viewerOwnership(db, viewerId);
  const books = (await listReads(db, friend.id, true)).map((b) => ({ ...b, mine: mineStatus(mine, b.book_id) }));
  return { ok: true, user: friend, books };
}

export async function getFriendWishlist(
  db: D1Database,
  viewerId: number,
  friendUsername: string
): Promise<{ ok: boolean; error?: string; user?: { id: number; username: string }; books?: WishlistRow[] }> {
  const friend = await queryOne<{ id: number; username: string }>(
    db,
    "SELECT id, username FROM users WHERE username = ? COLLATE NOCASE",
    friendUsername
  );
  if (!friend) return { ok: false, error: "User not found" };
  if (friend.id === viewerId) return { ok: false, error: "That's you — use your own wishlist" };
  if (!(await isFriend(db, viewerId, friend.id))) return { ok: false, error: "You are not friends with this user" };

  const mine = await viewerOwnership(db, viewerId);
  const books = (await listWishlist(db, friend.id, true)).map((b) => ({ ...b, mine: mineStatus(mine, b.book_id) }));
  return { ok: true, user: friend, books };
}

export async function getFriendReading(
  db: D1Database,
  viewerId: number,
  friendUsername: string
): Promise<{ ok: boolean; error?: string; user?: { id: number; username: string }; books?: ReadingRow[] }> {
  const friend = await queryOne<{ id: number; username: string }>(
    db,
    "SELECT id, username FROM users WHERE username = ? COLLATE NOCASE",
    friendUsername
  );
  if (!friend) return { ok: false, error: "User not found" };
  if (friend.id === viewerId) return { ok: false, error: "That's you — use your own list" };
  if (!(await isFriend(db, viewerId, friend.id))) return { ok: false, error: "You are not friends with this user" };
  const mine = await viewerOwnership(db, viewerId);
  const books = (await listReading(db, friend.id)).map((b) => ({ ...b, mine: mineStatus(mine, b.book_id) }));
  return { ok: true, user: friend, books };
}

// ---------- Book Details ----------

export interface FriendActivity {
  username: string;
  review: string | null;
  rank: number | null;
  owned: number;
  status: "read" | "wishlist" | "reading";
}

export interface BookDetail extends BookRow {
  friends: FriendActivity[];
}

export async function getBookDetail(db: D1Database, viewerId: number, bookId: number): Promise<BookDetail | null> {
  const book = await getBookById(db, bookId);
  if (!book) return null;

  const friends = await listFriends(db, viewerId);
  const activities: FriendActivity[] = [];

  for (const friend of friends) {
    const read = await queryOne<{ review: string | null; rank: number }>(
      db,
      "SELECT review, rank FROM reads WHERE user_id = ? AND book_id = ? AND public = 1",
      friend.user_id, bookId
    );
    if (read) {
      activities.push({ username: friend.username, review: read.review, rank: read.rank, owned: 0, status: "read" });
    }

    const wish = await queryOne<{ owned: number }>(
      db,
      "SELECT owned FROM wishlist WHERE user_id = ? AND book_id = ? AND public = 1",
      friend.user_id, bookId
    );
    if (wish) {
      activities.push({ username: friend.username, review: null, rank: null, owned: wish.owned, status: "wishlist" });
    }

    const reading = await queryOne(
      db,
      "SELECT 1 FROM reading WHERE user_id = ? AND book_id = ?",
      friend.user_id, bookId
    );
    if (reading) {
      activities.push({ username: friend.username, review: null, rank: null, owned: 0, status: "reading" });
    }
  }

  return { ...book, friends: activities };
}

// ---------- Backfill synopses ----------

export async function backfillSynopses(db: D1Database): Promise<{ updated: number; failed: number }> {
  const books = await queryAll<{ id: number; ol_key: string }>(
    db,
    "SELECT id, ol_key FROM books WHERE synopsis IS NULL AND ol_key NOT LIKE 'manual:%'"
  );

  let updated = 0;
  let failed = 0;

  for (const book of books) {
    try {
      const { fetchSynopsis } = await import("../ol");
      const synopsis = await fetchSynopsis(book.ol_key);
      if (synopsis) {
        await execute(db, "UPDATE books SET synopsis = ? WHERE id = ?", synopsis, book.id);
        updated++;
      }
    } catch {
      failed++;
    }
  }

  return { updated, failed };
}

// ---------- Admin features ----------

const MAX_BOOKS_PER_USER = 25;

export async function getUserReadCount(db: D1Database, userId: number): Promise<number> {
  const row = await queryOne<{ count: number }>(
    db,
    "SELECT COUNT(*) as count FROM reads WHERE user_id = ?",
    userId
  );
  return row?.count ?? 0;
}

export async function canAddMoreBooks(db: D1Database, userId: number): Promise<boolean> {
  const user = await getUserById(db, userId);
  if (!user) return false;
  
  // book_limit = 0 means unlimited
  if (user.book_limit === 0) return true;
  
  const count = await getUserReadCount(db, userId);
  return count < user.book_limit;
}

export async function getAdminUsers(db: D1Database): Promise<{ id: number; username: string }[]> {
  return await queryAll<{ id: number; username: string }>(
    db,
    "SELECT id, username FROM users WHERE is_admin = 1"
  );
}

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  message: string;
  data: string | null;
  read: number;
  created_at: number;
}

export async function createNotification(
  db: D1Database,
  userId: number,
  type: string,
  message: string,
  data?: any
): Promise<void> {
  await execute(
    db,
    "INSERT INTO notifications (user_id, type, message, data) VALUES (?, ?, ?, ?)",
    userId,
    type,
    message,
    data ? JSON.stringify(data) : null
  );
}

export async function notifyAdminsOfNewUser(
  db: D1Database,
  newUser: { id: number; username: string; email: string }
): Promise<void> {
  const admins = await getAdminUsers(db);
  for (const admin of admins) {
    await createNotification(
      db,
      admin.id,
      "new_user_signup",
      `New user signed up: @${newUser.username} (${newUser.email})`,
      { userId: newUser.id, username: newUser.username, email: newUser.email }
    );
  }
}

export async function getNotifications(
  db: D1Database,
  userId: number,
  unreadOnly = false
): Promise<Notification[]> {
  const query = unreadOnly
    ? "SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC"
    : "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC";
  const notifications = await queryAll<Notification>(db, query, userId);
  
  // For new_user_signup notifications, enrich with current user status
  for (const n of notifications) {
    if (n.type === "new_user_signup" && n.data) {
      try {
        const data = JSON.parse(n.data);
        // Handle both 'id' and 'userId' fields for backward compatibility
        const targetUserId = data.userId || data.id;
        if (targetUserId) {
          const user = await getUserById(db, targetUserId);
          if (user) {
            n.data = JSON.stringify({ ...data, status: user.status, rejected_at: user.rejected_at });
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    // For friend_request notifications, enrich with current request status
    if (n.type === "friend_request" && n.data) {
      try {
        const data = JSON.parse(n.data);
        if (data.requestId) {
          const f = await queryOne<{ status: string }>(db, "SELECT status FROM friendships WHERE id = ?", data.requestId);
          const status = !f ? "declined" : f.status === "accepted" ? "accepted" : "pending";
          n.data = JSON.stringify({ ...data, status });
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
  
  return notifications;
}

export async function getUnreadNotificationCount(db: D1Database, userId: number): Promise<number> {
  const row = await queryOne<{ count: number }>(
    db,
    "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0",
    userId
  );
  return row?.count ?? 0;
}

export async function dismissNotification(db: D1Database, userId: number, notificationId: number): Promise<void> {
  await execute(
    db,
    "UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?",
    notificationId,
    userId
  );
}

export async function dismissAllNotifications(db: D1Database, userId: number): Promise<void> {
  await execute(
    db,
    "UPDATE notifications SET read = 1 WHERE user_id = ?",
    userId
  );
}

export async function approveUser(db: D1Database, userId: number): Promise<void> {
  await execute(
    db,
    "UPDATE users SET status = 'approved', book_limit = 0 WHERE id = ?",
    userId
  );
}

export async function rejectUser(db: D1Database, userId: number): Promise<void> {
  await execute(
    db,
    "UPDATE users SET status = 'rejected', rejected_at = ? WHERE id = ?",
    now(),
    userId
  );
}

export async function getUserBookLimit(db: D1Database, userId: number): Promise<number> {
  const user = await getUserById(db, userId);
  return user?.book_limit ?? 25;
}

// Grace period for rejected accounts before deletion (7 days)
const REJECTION_GRACE_PERIOD_DAYS = 7;

export async function cleanupRejectedUsers(db: D1Database): Promise<{ deleted: number }> {
  const gracePeriodSeconds = REJECTION_GRACE_PERIOD_DAYS * 24 * 60 * 60;
  const cutoffTime = now() - gracePeriodSeconds;

  const result = await execute(
    db,
    "DELETE FROM users WHERE status = 'rejected' AND rejected_at IS NOT NULL AND rejected_at < ?",
    cutoffTime
  );

  return { deleted: result.changes || 0 };
}

// ---------- Clubs ----------

export interface ClubRow {
  id: number;
  name: string;
  description: string | null;
  creator_id: number;
  voting_open: number;
  runoff: number;
  created_at: number;
}

export interface ClubMemberRow {
  user_id: number;
  username: string;
  role: "owner" | "member";
  status: "pending" | "accepted";
  joined_at: number;
}

export interface ClubNominationRow {
  id: number;
  book_id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  user_id: number;
  nominatedBy: string;
  votes: number;
  vetoed_by: number | null;
  vetoedBy: string | null;
  created_at: number;
}

export interface ClubPickRow {
  id: number;
  book_id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  picked_at: number;
}

export interface ClubSummary {
  id: number;
  name: string;
  description: string | null;
  role: "owner" | "member";
  memberCount: number;
  voting_open: number;
  nominationCount: number;
  currentPick: ClubPickRow | null;
  created_at: number;
}

export interface ClubInviteSummary {
  clubId: number;
  name: string;
  description: string | null;
  inviter: string | null;
  invited_at: number;
}

export interface ClubDetail {
  club: ClubRow;
  myRole: "owner" | "member";
  votingOpen: boolean;
  runoff: boolean;
  members: ClubMemberRow[];
  nominations: ClubNominationRow[];
  myVote: number | null;
  myVetoUsed: boolean;
  currentPick: ClubPickRow | null;
  pastPicks: ClubPickRow[];
}

async function getClubMembership(
  db: D1Database,
  clubId: number,
  userId: number
): Promise<{ role: "owner" | "member"; status: "pending" | "accepted"; invited_by: number | null } | null> {
  return await queryOne(db, "SELECT role, status, invited_by FROM club_members WHERE club_id = ? AND user_id = ?", clubId, userId);
}

async function notifyAcceptedMembers(
  db: D1Database,
  clubId: number,
  excludeUserId: number,
  type: string,
  message: string,
  data?: any
): Promise<void> {
  const members = await queryAll<{ user_id: number }>(
    db,
    "SELECT user_id FROM club_members WHERE club_id = ? AND status = 'accepted' AND user_id != ?",
    clubId, excludeUserId
  );
  for (const m of members) {
    await createNotification(db, m.user_id, type, message, data);
  }
}

export async function createClub(
  db: D1Database,
  creatorId: number,
  name: string,
  description?: string,
  usernames: string[] = []
): Promise<{ ok: boolean; error?: string; club?: ClubRow; invited?: string[]; skipped?: string[] }> {
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName) return { ok: false, error: "Club name is required" };
  if (cleanName.length > 80) return { ok: false, error: "Club name must be 80 characters or fewer" };
  const cleanDesc = typeof description === "string" && description.trim() ? description.trim().slice(0, 500) : null;

  const creator = await getUserById(db, creatorId);
  const creatorName = creator?.username ?? "Someone";

  await execute(db, "INSERT INTO clubs (name, description, creator_id) VALUES (?, ?, ?)", cleanName, cleanDesc, creatorId);
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE creator_id = ? ORDER BY id DESC LIMIT 1", creatorId);
  if (!club) return { ok: false, error: "Could not create club" };
  await execute(
    db,
    "INSERT INTO club_members (club_id, user_id, role, status, invited_by) VALUES (?, ?, 'owner', 'accepted', ?)",
    club.id, creatorId, creatorId
  );

  const invited: string[] = [];
  const skipped: string[] = [];
  for (const raw of usernames.slice(0, 50)) {
    const target = await findUser(db, String(raw).trim());
    if (!target || target.id === creatorId) { skipped.push(String(raw).trim()); continue; }
    const existing = await getClubMembership(db, club.id, target.id);
    if (existing) { skipped.push(target.username); continue; }
    if (!(await isFriend(db, creatorId, target.id))) { skipped.push(target.username); continue; }
    await execute(
      db,
      "INSERT INTO club_members (club_id, user_id, role, status, invited_by) VALUES (?, ?, 'member', 'pending', ?)",
      club.id, target.id, creatorId
    );
    await createNotification(
      db, target.id, "club_invite",
      `@${creatorName} invited you to the club "${cleanName}"`,
      { clubId: club.id, name: cleanName, userId: creatorId, username: creatorName }
    );
    invited.push(target.username);
  }

  return { ok: true, club, invited, skipped };
}

export async function listClubsForUser(db: D1Database, userId: number): Promise<{ clubs: ClubSummary[]; invites: ClubInviteSummary[] }> {
  const clubs = await queryAll<ClubSummary & { creator_id: number }>(
    db,
    `SELECT c.id, c.name, c.description, c.creator_id, c.voting_open, c.created_at, m.role,
       (SELECT COUNT(*) FROM club_members cm WHERE cm.club_id = c.id AND cm.status = 'accepted') AS memberCount,
       (SELECT COUNT(*) FROM club_nominations n WHERE n.club_id = c.id) AS nominationCount
     FROM clubs c JOIN club_members m ON m.club_id = c.id
     WHERE m.user_id = ? AND m.status = 'accepted'
     ORDER BY c.created_at DESC`,
    userId
  );

  const invites = await queryAll<ClubInviteSummary>(
    db,
    `SELECT m.club_id AS clubId, c.name, c.description, m.joined_at AS invited_at,
       (SELECT username FROM users WHERE id = m.invited_by) AS inviter
     FROM club_members m JOIN clubs c ON c.id = m.club_id
     WHERE m.user_id = ? AND m.status = 'pending'
     ORDER BY m.joined_at DESC`,
    userId
  );

  // Attach each club's current (latest) pick
  const summaries: ClubSummary[] = [];
  for (const c of clubs) {
    const pick = await queryOne<ClubPickRow>(
      db,
      `SELECT p.id, p.book_id, p.picked_at, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual
       FROM club_picks p JOIN books b ON b.id = p.book_id
       WHERE p.club_id = ? ORDER BY p.picked_at DESC, p.id DESC LIMIT 1`,
      c.id
    );
    const { creator_id, ...rest } = c;
    summaries.push({ ...rest, currentPick: pick ?? null });
  }

  return { clubs: summaries, invites };
}

export async function getClub(db: D1Database, userId: number, clubId: number): Promise<{ ok: boolean; error?: string; club?: ClubDetail }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership) return { ok: false, error: "You are not a member of this club" };
  if (membership.status !== "accepted") return { ok: false, error: "You haven't joined this club yet" };

  const members = await queryAll<ClubMemberRow>(
    db,
    `SELECT m.user_id, u.username, m.role, m.status, m.joined_at
     FROM club_members m JOIN users u ON u.id = m.user_id
     WHERE m.club_id = ?
     ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, CASE m.status WHEN 'accepted' THEN 0 ELSE 1 END, u.username COLLATE NOCASE`,
    clubId
  );

  const nominations = await queryAll<ClubNominationRow>(
    db,
    `SELECT n.id, n.book_id, n.user_id, n.created_at, n.vetoed_by,
       u.username AS nominatedBy,
       (SELECT username FROM users WHERE id = n.vetoed_by) AS vetoedBy,
       b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual,
       (SELECT COUNT(*) FROM club_votes v WHERE v.nomination_id = n.id) AS votes
     FROM club_nominations n
     JOIN books b ON b.id = n.book_id
     JOIN users u ON u.id = n.user_id
     WHERE n.club_id = ?
     ORDER BY n.created_at ASC`,
    clubId
  );

  const myVoteRow = await queryOne<{ nomination_id: number }>(
    db,
    `SELECT v.nomination_id FROM club_votes v
     JOIN club_nominations n ON n.id = v.nomination_id
     WHERE v.user_id = ? AND n.club_id = ?`,
    userId, clubId
  );

  const myVetoRow = await queryOne(
    db,
    "SELECT 1 FROM club_nominations WHERE club_id = ? AND vetoed_by = ?",
    clubId, userId
  );

  const picks = await queryAll<ClubPickRow>(
    db,
    `SELECT p.id, p.book_id, p.picked_at, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual
     FROM club_picks p JOIN books b ON b.id = p.book_id
     WHERE p.club_id = ? ORDER BY p.picked_at DESC, p.id DESC`,
    clubId
  );

  const detail: ClubDetail = {
    club,
    myRole: membership.role,
    votingOpen: club.voting_open === 1,
    runoff: club.runoff === 1,
    members,
    nominations,
    myVote: myVoteRow?.nomination_id ?? null,
    myVetoUsed: !!myVetoRow,
    currentPick: picks[0] ?? null,
    pastPicks: picks.slice(1),
  };
  return { ok: true, club: detail };
}

export async function inviteToClub(
  db: D1Database,
  inviterId: number,
  clubId: number,
  username: string
): Promise<{ ok: boolean; error?: string; username?: string }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, inviterId);
  if (!membership || membership.status !== "accepted") return { ok: false, error: "You are not a member of this club" };

  const target = await findUser(db, String(username ?? "").trim());
  if (!target) return { ok: false, error: "User not found" };
  if (target.id === inviterId) return { ok: false, error: "You are already in this club" };
  if (!(await isFriend(db, inviterId, target.id))) return { ok: false, error: "You can only invite friends" };
  const existing = await getClubMembership(db, clubId, target.id);
  if (existing) {
    return { ok: false, error: existing.status === "accepted" ? `${target.username} is already a member` : `${target.username} is already invited` };
  }

  const inviter = await getUserById(db, inviterId);
  const inviterName = inviter?.username ?? "Someone";

  await execute(
    db,
    "INSERT INTO club_members (club_id, user_id, role, status, invited_by) VALUES (?, ?, 'member', 'pending', ?)",
    clubId, target.id, inviterId
  );
  await createNotification(
    db, target.id, "club_invite",
    `@${inviterName} invited you to the club "${club.name}"`,
    { clubId, name: club.name, userId: inviterId, username: inviterName }
  );
  return { ok: true, username: target.username };
}

export async function respondToClubInvite(
  db: D1Database,
  userId: number,
  clubId: number,
  accept: boolean
): Promise<{ ok: boolean; error?: string }> {
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.status !== "pending") return { ok: false, error: "No pending invite for this club" };

  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };

  if (accept) {
    await execute(db, "UPDATE club_members SET status = 'accepted' WHERE club_id = ? AND user_id = ?", clubId, userId);
    const joiner = await getUserById(db, userId);
    if (joiner && membership.invited_by) {
      await createNotification(
        db, membership.invited_by, "club_joined",
        `@${joiner.username} joined the club "${club.name}"`,
        { clubId, name: club.name, userId, username: joiner.username }
      );
    }
  } else {
    await execute(db, "DELETE FROM club_members WHERE club_id = ? AND user_id = ?", clubId, userId);
  }

  // The invite is handled — whether the user accepts it here or in the
  // notifications panel, its club_invite notification is dealt with. The
  // data payload starts with {"clubId":N, so the comma keeps club 1 from
  // matching club 11, etc.
  await execute(
    db,
    "UPDATE notifications SET read = 1 WHERE user_id = ? AND type = 'club_invite' AND data LIKE ?",
    userId,
    `%"clubId":${clubId},%`
  );
  return { ok: true };
}

export async function nominateBook(
  db: D1Database,
  userId: number,
  clubId: number,
  opts: { olKey?: string; bookId?: number; year?: number }
): Promise<{ ok: boolean; error?: string; nomination?: ClubNominationRow }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.status !== "accepted") return { ok: false, error: "You are not a member of this club" };
  if (club.voting_open !== 1) return { ok: false, error: "Voting is closed for the current pick" };
  if (club.runoff === 1) return { ok: false, error: "Nominations are paused during the runoff" };

  let book: BookRow | null = null;
  if (opts.bookId != null) {
    book = await getBookById(db, Number(opts.bookId));
    if (!book) return { ok: false, error: "Book not found" };
  } else if (opts.olKey) {
    book = await getOrCreateBookByKey(db, opts.olKey, opts.year);
    if (!book) return { ok: false, error: "Could not load book from Open Library" };
  } else {
    return { ok: false, error: "ol_key or book_id is required" };
  }

  const dup = await queryOne(db, "SELECT 1 FROM club_nominations WHERE club_id = ? AND book_id = ?", clubId, book.id);
  if (dup) return { ok: false, error: "That book is already nominated" };

  await execute(db, "INSERT INTO club_nominations (club_id, user_id, book_id) VALUES (?, ?, ?)", clubId, userId, book.id);

  const nominator = await getUserById(db, userId);
  await notifyAcceptedMembers(
    db, clubId, userId, "club_nomination",
    `@${nominator?.username ?? "Someone"} nominated "${book.title}" in "${club.name}"`,
    { clubId, name: club.name, nominationBook: book.title }
  );

  const nomination = await queryOne<ClubNominationRow>(
    db,
    `SELECT n.id, n.book_id, n.user_id, n.created_at, n.vetoed_by,
       u.username AS nominatedBy,
       (SELECT username FROM users WHERE id = n.vetoed_by) AS vetoedBy,
       b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual,
       (SELECT COUNT(*) FROM club_votes v WHERE v.nomination_id = n.id) AS votes
     FROM club_nominations n JOIN books b ON b.id = n.book_id JOIN users u ON u.id = n.user_id
     WHERE n.club_id = ? AND n.book_id = ?`,
    clubId, book.id
  );
  return { ok: true, nomination: nomination ?? undefined };
}

export async function voteForNomination(
  db: D1Database,
  userId: number,
  clubId: number,
  nominationId: number
): Promise<{ ok: boolean; error?: string }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.status !== "accepted") return { ok: false, error: "You are not a member of this club" };
  if (club.voting_open !== 1) return { ok: false, error: "Voting is closed for the current pick" };

  const nomination = await queryOne<{ vetoed_by: number | null }>(
    db,
    "SELECT vetoed_by FROM club_nominations WHERE id = ? AND club_id = ?",
    nominationId, clubId
  );
  if (!nomination) return { ok: false, error: "Nomination not found" };
  if (nomination.vetoed_by != null) return { ok: false, error: "That nomination was vetoed" };

  // One vote per member per club: replace any previous vote.
  await execute(
    db,
    "DELETE FROM club_votes WHERE user_id = ? AND nomination_id IN (SELECT id FROM club_nominations WHERE club_id = ?)",
    userId, clubId
  );
  await execute(db, "INSERT INTO club_votes (nomination_id, user_id) VALUES (?, ?)", nominationId, userId);
  return { ok: true };
}

export async function removeVote(db: D1Database, userId: number, clubId: number): Promise<{ ok: boolean; error?: string }> {
  await execute(
    db,
    "DELETE FROM club_votes WHERE user_id = ? AND nomination_id IN (SELECT id FROM club_nominations WHERE club_id = ?)",
    userId, clubId
  );
  return { ok: true };
}

export async function vetoNomination(
  db: D1Database,
  userId: number,
  clubId: number,
  nominationId: number
): Promise<{ ok: boolean; error?: string }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.status !== "accepted") return { ok: false, error: "You are not a member of this club" };
  if (club.voting_open !== 1) return { ok: false, error: "Voting is closed for the current pick" };

  const nomination = await queryOne<{ vetoed_by: number | null; title: string }>(
    db,
    `SELECT n.vetoed_by, b.title FROM club_nominations n JOIN books b ON b.id = n.book_id
     WHERE n.id = ? AND n.club_id = ?`,
    nominationId, clubId
  );
  if (!nomination) return { ok: false, error: "Nomination not found" };
  if (nomination.vetoed_by != null) return { ok: false, error: "That nomination was already vetoed" };

  // One veto per member per vote cycle (a cycle's vetoes die with its
  // nominations when the vote closes).
  const used = await queryOne(db, "SELECT 1 FROM club_nominations WHERE club_id = ? AND vetoed_by = ?", clubId, userId);
  if (used) return { ok: false, error: "You've already used your veto for this vote" };

  await execute(db, "UPDATE club_nominations SET vetoed_by = ? WHERE id = ?", userId, nominationId);
  // Anyone voting for it gets their vote back.
  await execute(db, "DELETE FROM club_votes WHERE nomination_id = ?", nominationId);

  const vetoer = await getUserById(db, userId);
  await notifyAcceptedMembers(
    db, clubId, userId, "club_veto",
    `@${vetoer?.username ?? "Someone"} vetoed "${nomination.title}" in "${club.name}"`,
    { clubId, name: club.name, bookTitle: nomination.title }
  );
  return { ok: true };
}

export async function removeNomination(
  db: D1Database,
  userId: number,
  clubId: number,
  nominationId: number
): Promise<{ ok: boolean; error?: string }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.status !== "accepted") return { ok: false, error: "You are not a member of this club" };
  if (membership.role !== "owner") return { ok: false, error: "Only the club owner can remove nominations" };

  const nomination = await queryOne<{ title: string }>(
    db,
    `SELECT b.title FROM club_nominations n JOIN books b ON b.id = n.book_id
     WHERE n.id = ? AND n.club_id = ?`,
    nominationId, clubId
  );
  if (!nomination) return { ok: false, error: "Nomination not found" };

  // A removal takes the book out entirely — votes on it are released, and
  // because the row is gone it can be nominated again like new. Unlike a
  // veto it isn't recorded anywhere (that's the point: it never belonged).
  await execute(db, "DELETE FROM club_votes WHERE nomination_id = ?", nominationId);
  await execute(db, "DELETE FROM club_nominations WHERE id = ?", nominationId);

  const owner = await getUserById(db, userId);
  await notifyAcceptedMembers(
    db, clubId, userId, "club_nomination_removed",
    `@${owner?.username ?? "Someone"} removed "${nomination.title}" from the vote in "${club.name}"`,
    { clubId, name: club.name, bookTitle: nomination.title }
  );
  return { ok: true };
}

// The runoff field: the top two vote-getters. A tie at the top keeps all
// tied leaders; a single leader is joined by whoever ties for second.
function runoffField<T extends { votes: number }>(nominations: T[]): T[] {
  const topVotes = Math.max(...nominations.map((n) => n.votes));
  const leaders = nominations.filter((n) => n.votes === topVotes);
  if (leaders.length > 1) return leaders;
  const rest = nominations.filter((n) => n.votes < topVotes);
  if (rest.length === 0) return leaders;
  const runnerUpVotes = Math.max(...rest.map((n) => n.votes));
  return [...leaders, ...rest.filter((n) => n.votes === runnerUpVotes)];
}

export async function closeVote(
  db: D1Database,
  userId: number,
  clubId: number
): Promise<{ ok: boolean; error?: string; pick?: ClubPickRow; runoffNeeded?: boolean; runoffTitles?: string[] }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.role !== "owner") return { ok: false, error: "Only the club owner can close the vote" };
  if (club.voting_open !== 1) return { ok: false, error: "Voting is already closed" };

  // Vetoed nominations can't win — only active ones count.
  const nominations = await queryAll<{ id: number; book_id: number; title: string; votes: number; created_at: number }>(
    db,
    `SELECT n.id, n.book_id, n.created_at, b.title,
       (SELECT COUNT(*) FROM club_votes v WHERE v.nomination_id = n.id) AS votes
     FROM club_nominations n JOIN books b ON b.id = n.book_id
     WHERE n.club_id = ? AND n.vetoed_by IS NULL`,
    clubId
  );
  if (nominations.length === 0) {
    const anyVetoed = await queryOne(db, "SELECT 1 FROM club_nominations WHERE club_id = ? AND vetoed_by IS NOT NULL", clubId);
    return { ok: false, error: anyVetoed ? "Every nomination was vetoed" : "No nominations yet" };
  }
  const totalVotes = nominations.reduce((sum, n) => sum + n.votes, 0);
  if (totalVotes === 0) return { ok: false, error: "No votes cast yet" };

  // The winner needs a simple majority — more than half the votes cast.
  // A tie at the top, or a leader short of a majority, goes to a runoff
  // instead of an arbitrary winner.
  const topVotes = Math.max(...nominations.map((n) => n.votes));
  const leaders = nominations.filter((n) => n.votes === topVotes);
  if (leaders.length > 1 || leaders[0].votes * 2 <= totalVotes) {
    const field = runoffField(nominations);
    const runoffTitles = field.map((n) => n.title);
    const reason =
      leaders.length > 1
        ? `It's a tie between ${leaders.map((n) => `"${n.title}"`).join(" and ")}`
        : `"${leaders[0].title}" leads with ${leaders[0].votes} of ${totalVotes} votes — short of a majority`;
    return {
      ok: false,
      error: `${reason} — start a runoff`,
      runoffNeeded: true,
      runoffTitles,
    };
  }

  const winner = leaders[0];

  await execute(db, "INSERT INTO club_picks (club_id, book_id) VALUES (?, ?)", clubId, winner.book_id);
  await execute(db, "DELETE FROM club_votes WHERE nomination_id IN (SELECT id FROM club_nominations WHERE club_id = ?)", clubId);
  await execute(db, "DELETE FROM club_nominations WHERE club_id = ?", clubId);
  await execute(db, "UPDATE clubs SET voting_open = 0, runoff = 0 WHERE id = ?", clubId);

  await notifyAcceptedMembers(
    db, clubId, userId, "club_pick",
    `"${winner.title}" won the vote in "${club.name}"`,
    { clubId, name: club.name, bookId: winner.book_id, bookTitle: winner.title }
  );

  const pick = await queryOne<ClubPickRow>(
    db,
    `SELECT p.id, p.book_id, p.picked_at, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual
     FROM club_picks p JOIN books b ON b.id = p.book_id
     WHERE p.club_id = ? ORDER BY p.picked_at DESC, p.id DESC LIMIT 1`,
    clubId
  );
  return { ok: true, pick: pick ?? undefined };
}

export async function startRunoff(
  db: D1Database,
  userId: number,
  clubId: number
): Promise<{ ok: boolean; error?: string; runoffTitles?: string[] }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.role !== "owner") return { ok: false, error: "Only the club owner can start a runoff" };
  if (club.voting_open !== 1) return { ok: false, error: "Voting is closed for the current pick" };

  const active = await queryAll<{ id: number; title: string; votes: number }>(
    db,
    `SELECT n.id, b.title,
       (SELECT COUNT(*) FROM club_votes v WHERE v.nomination_id = n.id) AS votes
     FROM club_nominations n JOIN books b ON b.id = n.book_id
     WHERE n.club_id = ? AND n.vetoed_by IS NULL
     ORDER BY n.created_at ASC`,
    clubId
  );
  const totalVotes = active.reduce((sum, n) => sum + n.votes, 0);
  if (totalVotes === 0) return { ok: false, error: "No votes cast yet" };

  const topVotes = Math.max(...active.map((n) => n.votes));
  const leaders = active.filter((n) => n.votes === topVotes);
  if (leaders.length === 1 && leaders[0].votes * 2 > totalVotes) {
    return { ok: false, error: `"${leaders[0].title}" already has a majority (${leaders[0].votes} of ${totalVotes} votes) — close the vote to pick it` };
  }

  // Drop the also-rans and reset the votes on the runoff field so everyone
  // re-votes with the final field in view. Vetoed rows stay struck until the
  // vote closes.
  const field = runoffField(active);
  const fieldIds = field.map((n) => n.id);
  await execute(
    db,
    `DELETE FROM club_nominations WHERE club_id = ? AND id NOT IN (${fieldIds.map(() => "?").join(",")}) AND vetoed_by IS NULL`,
    clubId, ...fieldIds
  );
  await execute(
    db,
    `DELETE FROM club_votes WHERE nomination_id IN (${fieldIds.map(() => "?").join(",")})`,
    ...fieldIds
  );
  await execute(db, "UPDATE clubs SET runoff = 1 WHERE id = ?", clubId);

  const runoffTitles = field.map((n) => n.title);
  await notifyAcceptedMembers(
    db, clubId, userId, "club_runoff",
    `Runoff in "${club.name}": ${runoffTitles.map((t) => `"${t}"`).join(" vs ")} — vote again!`,
    { clubId, name: club.name, runoffTitles }
  );
  return { ok: true, runoffTitles };
}

export async function reopenVote(db: D1Database, userId: number, clubId: number): Promise<{ ok: boolean; error?: string }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.role !== "owner") return { ok: false, error: "Only the club owner can start a new vote" };
  if (club.voting_open === 1) return { ok: false, error: "Voting is already open" };

  await execute(db, "UPDATE clubs SET voting_open = 1, runoff = 0 WHERE id = ?", clubId);
  await notifyAcceptedMembers(
    db, clubId, userId, "club_vote_reopen",
    `Voting for the next book is open in "${club.name}"`,
    { clubId, name: club.name }
  );
  return { ok: true };
}

export async function removeClubMember(
  db: D1Database,
  userId: number,
  clubId: number,
  targetUserId: number
): Promise<{ ok: boolean; error?: string }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.role !== "owner") return { ok: false, error: "Only the club owner can remove members" };
  if (targetUserId === userId) return { ok: false, error: "You can't remove yourself" };

  const target = await getClubMembership(db, clubId, targetUserId);
  if (!target) return { ok: false, error: "Member not found" };
  if (target.role === "owner") return { ok: false, error: "You can't remove the club owner" };

  await execute(db, "DELETE FROM club_members WHERE club_id = ? AND user_id = ?", clubId, targetUserId);
  await execute(
    db,
    "DELETE FROM club_votes WHERE user_id = ? AND nomination_id IN (SELECT id FROM club_nominations WHERE club_id = ?)",
    targetUserId, clubId
  );
  return { ok: true };
}

export async function leaveClub(db: D1Database, userId: number, clubId: number): Promise<{ ok: boolean; error?: string }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership) return { ok: false, error: "You are not a member of this club" };
  if (membership.role === "owner") {
    return { ok: false, error: "Owners can't leave directly — transfer ownership or delete the club" };
  }

  await execute(db, "DELETE FROM club_members WHERE club_id = ? AND user_id = ?", clubId, userId);
  await execute(
    db,
    "DELETE FROM club_votes WHERE user_id = ? AND nomination_id IN (SELECT id FROM club_nominations WHERE club_id = ?)",
    userId, clubId
  );
  return { ok: true };
}

export async function deleteClub(db: D1Database, userId: number, clubId: number): Promise<{ ok: boolean; error?: string }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.role !== "owner") return { ok: false, error: "Only the club owner can delete the club" };

  await execute(db, "DELETE FROM clubs WHERE id = ?", clubId);
  return { ok: true };
}

export async function transferClubOwnership(
  db: D1Database,
  userId: number,
  clubId: number,
  targetUserId: number
): Promise<{ ok: boolean; error?: string }> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership || membership.role !== "owner") return { ok: false, error: "Only the club owner can transfer ownership" };
  if (targetUserId === userId) return { ok: false, error: "You already own this club" };

  const target = await getClubMembership(db, clubId, targetUserId);
  if (!target || target.status !== "accepted") return { ok: false, error: "Pick an accepted member of this club" };
  if (target.role === "owner") return { ok: false, error: "That member already owns this club" };

  // The successor takes over; the former owner leaves the club (their vote
  // goes with them, same as a regular leave).
  await execute(db, "UPDATE club_members SET role = 'owner' WHERE club_id = ? AND user_id = ?", clubId, targetUserId);
  await execute(db, "DELETE FROM club_members WHERE club_id = ? AND user_id = ?", clubId, userId);
  await execute(
    db,
    "DELETE FROM club_votes WHERE user_id = ? AND nomination_id IN (SELECT id FROM club_nominations WHERE club_id = ?)",
    userId, clubId
  );

  const oldOwner = await getUserById(db, userId);
  const newOwner = await getUserById(db, targetUserId);
  if (newOwner) {
    await createNotification(
      db, targetUserId, "club_owner",
      `@${oldOwner?.username ?? "Someone"} transferred ownership of "${club.name}" to you`,
      { clubId, name: club.name, userId, username: oldOwner?.username }
    );
  }
  return { ok: true };
}

// Cheap change detection for the live club stream: the string shifts any
// time something visible on the club page changes (club, membership, roles,
// nominations, vetoes, votes, picks, runoff state). One query per check.
export async function getClubVersion(db: D1Database, clubId: number): Promise<string> {
  const row = await queryOne<{ c: string }>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM clubs WHERE id = ?) || '-' ||
       (SELECT COUNT(*) FROM club_members WHERE club_id = ?) || '-' ||
       (SELECT COUNT(*) FROM club_members WHERE club_id = ? AND role = 'owner') || '-' ||
       (SELECT COUNT(*) FROM club_members WHERE club_id = ? AND status = 'accepted') || '-' ||
       (SELECT COALESCE(MAX(runoff), 0) FROM clubs WHERE id = ?) || '-' ||
       (SELECT COUNT(*) FROM club_nominations WHERE club_id = ?) || '-' ||
       (SELECT COUNT(*) FROM club_nominations WHERE club_id = ? AND vetoed_by IS NOT NULL) || '-' ||
       (SELECT COUNT(*) FROM club_votes v JOIN club_nominations n ON n.id = v.nomination_id WHERE n.club_id = ?) || '-' ||
       (SELECT COALESCE(MAX(v.created_at), 0) FROM club_votes v JOIN club_nominations n ON n.id = v.nomination_id WHERE n.club_id = ?) || '-' ||
       (SELECT COALESCE(MAX(created_at), 0) FROM club_nominations WHERE club_id = ?) || '-' ||
       (SELECT COUNT(*) FROM club_picks WHERE club_id = ?)
     AS c`,
    clubId, clubId, clubId, clubId, clubId, clubId, clubId, clubId, clubId, clubId, clubId
  );
  return row?.c ?? "0-0-0-0-0-0-0-0-0-0-0";
}
