import { queryOne, queryAll, execute, now } from "./db";
import { fetchWork, type OLWork } from "../ol";

export interface User {
  id: number;
  username: string;
  email: string;
}

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  return await queryOne<User>(db, "SELECT id, username, email FROM users WHERE id = ?", id);
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
    "SELECT id, username FROM users WHERE id != ? AND (username LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE) ORDER BY username LIMIT ?",
    excludeId, like, like, limit
  );
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

  const existing = await queryOne<any>(
    db,
    "SELECT * FROM friendships WHERE (requester_id = ? AND requestee_id = ?) OR (requester_id = ? AND requestee_id = ?)",
    requesterId, target.id, target.id, requesterId
  );

  if (existing) {
    if (existing.status === "accepted") return { ok: false, error: "You are already friends" };
    if (existing.requester_id === requesterId) return { ok: false, error: "Friend request already sent" };
    await execute(db, "UPDATE friendships SET status = 'accepted' WHERE id = ?", existing.id);
    return { ok: true, autoAccepted: true, username: target.username };
  }

  await execute(db, "INSERT INTO friendships (requester_id, requestee_id, status) VALUES (?, ?, 'pending')", requesterId, target.id);
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
  const f = await queryOne(db, "SELECT 1 FROM friendships WHERE id = ? AND requestee_id = ? AND status = 'pending'", requestId, userId);
  if (!f) return { ok: false, error: "Request not found" };
  await execute(db, "UPDATE friendships SET status = 'accepted' WHERE id = ?", requestId);
  return { ok: true };
}

export async function declineFriendRequest(db: D1Database, userId: number, requestId: number): Promise<{ ok: boolean; error?: string }> {
  await execute(db, "DELETE FROM friendships WHERE id = ? AND requestee_id = ? AND status = 'pending'", requestId, userId);
  return { ok: true };
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
