import { db, now } from "./db";
import { fetchWork, type OLWork } from "./ol";

export interface User {
  id: number;
  username: string;
  email: string;
}

export function getUserById(id: number): User | null {
  const r = db.query("SELECT id, username, email FROM users WHERE id = ?").get(id) as User | undefined;
  return r ?? null;
}

export function findUser(identifier: string): (User & { password_hash: string }) | null {
  const r = db.query(
    "SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE"
  ).get(identifier, identifier) as any;
  return r ?? null;
}

export function createUser(username: string, email: string, passwordHash: string): User {
  db.query("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)")
    .run(username, email, passwordHash);
  return db.query("SELECT id, username, email FROM users WHERE username = ?").get(username) as User;
}

export function usernameExists(username: string): boolean {
  return !!db.query("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(username);
}

export function emailExists(email: string): boolean {
  return !!db.query("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(email);
}

export function searchUsers(query: string, excludeId: number, limit = 20): { id: number; username: string }[] {
  const like = `%${query}%`;
  return db.query(
    "SELECT id, username FROM users WHERE id != ? AND (username LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE) ORDER BY username LIMIT ?"
  ).all(excludeId, like, like, limit) as { id: number; username: string }[];
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

export function getBookByOlKey(key: string): BookRow | null {
  const r = db.query("SELECT * FROM books WHERE ol_key = ?").get(key) as BookRow | undefined;
  return r ?? null;
}

export function getExistingBookKeys(keys: string[]): Set<string> {
  if (keys.length === 0) return new Set();
  const placeholders = keys.map(() => "?").join(",");
  const rows = db.query(`SELECT ol_key FROM books WHERE ol_key IN (${placeholders})`)
    .all(...keys) as { ol_key: string }[];
  return new Set(rows.map(r => r.ol_key));
}

export function getBookById(id: number): BookRow | null {
  const r = db.query("SELECT * FROM books WHERE id = ?").get(id) as BookRow | undefined;
  return r ?? null;
}

export function setBookCover(id: number, coverUrl: string): BookRow | null {
  db.query("UPDATE books SET cover_url = ? WHERE id = ?").run(coverUrl, id);
  return getBookById(id);
}

function insertBook(w: OLWork, yearHint?: number): BookRow {
  db.query("INSERT INTO books (ol_key, title, author, cover_url, first_publish_year, synopsis) VALUES (?, ?, ?, ?, ?, ?)")
    .run(w.key, w.title, w.author || null, w.coverUrl || null, yearHint ?? w.year ?? null, w.synopsis ?? null);
  return getBookByOlKey(w.key)!;
}

export async function getOrCreateBookByKey(olKey: string, yearHint?: number): Promise<BookRow | null> {
  const existing = getBookByOlKey(olKey);
  if (existing) {
    if (!existing.first_publish_year && yearHint) {
      db.query("UPDATE books SET first_publish_year = ? WHERE id = ?").run(yearHint, existing.id);
      return getBookById(existing.id);
    }
    return existing;
  }
  const w = await fetchWork(olKey);
  if (!w) return null;
  return insertBook(w, yearHint);
}

// ---------- Reads (a user's ranked list) ----------

export function listReads(userId: number, publicOnly = false): ReadRow[] {
  const pub = publicOnly ? "AND r.public = 1" : "";
  return db.query(`
    SELECT r.book_id, r.rank, r.review, r.public, r.created_at, r.updated_at,
           b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis
    FROM reads r JOIN books b ON b.id = r.book_id
    WHERE r.user_id = ? ${pub} ORDER BY r.rank ASC
  `).all(userId) as ReadRow[];
}

function tx(fn: () => void): void {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function insertReadEntry(
  userId: number,
  bookId: number,
  review?: string,
  rank?: number,
  isPublic?: boolean
): { ok: boolean; error?: string } {
  const existing = db.query("SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (existing) return { ok: false, error: "This book is already on your list" };

  const max = db.query("SELECT COALESCE(MAX(rank), 0) AS m FROM reads WHERE user_id = ?").get(userId) as { m: number };
  const maxRank: number = max?.m ?? 0;
  let r: number;
  if (rank == null) r = maxRank + 1;
  else r = Math.min(Math.max(Math.round(rank), 1), maxRank + 1);

  tx(() => {
    if (rank != null) {
      db.query("UPDATE reads SET rank = rank + 1 WHERE user_id = ? AND rank >= ?").run(userId, r);
    }
    db.query("INSERT INTO reads (user_id, book_id, rank, review, public) VALUES (?, ?, ?, ?, ?)")
      .run(userId, bookId, r, review ?? null, isPublic === false ? 0 : 1);
  });

  return { ok: true };
}

export async function addRead(
  userId: number,
  olKey?: string,
  review?: string,
  rank?: number,
  year?: number,
  isPublic?: boolean
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  if (!olKey) return { ok: false, error: "ol_key is required" };
  const book = await getOrCreateBookByKey(olKey, year);
  if (!book) return { ok: false, error: "Could not load book from Open Library" };

  const r = insertReadEntry(userId, book.id, review, rank, isPublic);
  if (r.error) return { ok: false, error: r.error };

  return { ok: true, book };
}

export interface ManualBookFields {
  title?: string;
  author?: string;
  year?: number;
  coverUrl?: string;
}

export function createManualBook(fields: ManualBookFields): { ok: boolean; error?: string; book?: BookRow } {
  const title = typeof fields?.title === "string" ? fields.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required" };

  const author =
    typeof fields.author === "string" && fields.author.trim() ? fields.author.trim() : null;
  const coverUrl =
    typeof fields.coverUrl === "string" && fields.coverUrl.trim() ? fields.coverUrl.trim() : null;
  const year = typeof fields.year === "number" && Number.isFinite(fields.year) ? Math.round(fields.year) : null;

  const olKey = "manual:" + crypto.randomUUID();
  db.query(
    "INSERT INTO books (ol_key, title, author, cover_url, first_publish_year, manual) VALUES (?, ?, ?, ?, ?, 1)"
  ).run(olKey, title, author, coverUrl, year);

  return { ok: true, book: getBookByOlKey(olKey)! };
}

export function addManualBook(
  userId: number,
  fields: ManualBookFields,
  review?: string,
  rank?: number,
  isPublic?: boolean
): { ok: boolean; error?: string; book?: BookRow } {
  const c = createManualBook(fields);
  if (c.error || !c.book) return { ok: false, error: c.error };
  const r = insertReadEntry(userId, c.book.id, review, rank, isPublic);
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

export function listWishlist(userId: number, publicOnly = false): WishlistRow[] {
  const pub = publicOnly ? "AND w.public = 1" : "";
  return db.query(`
    SELECT w.book_id, w.owned, w.public, w.rank, w.created_at,
           b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis
    FROM wishlist w JOIN books b ON b.id = w.book_id
    WHERE w.user_id = ? ${pub} ORDER BY w.rank ASC
  `).all(userId) as WishlistRow[];
}

export interface NextUpRow extends WishlistRow {
  reason: "owned" | "friend";
  friendUsername?: string;
}

/**
 * Compute "Next up" books for the user.
 *
 * Priority:
 * 1. Owned books on the user's wishlist (ordered by rank — top of wishlist first).
 * 2. Books on the user's wishlist that a friend has read (i.e. sits in a friend's reads).
 * 3. Fallback: top books from the wishlist when neither of the above yields results.
 */
export function getNextUp(userId: number, limit = 1): NextUpRow[] {
  // 1. Owned wishlist items, ranked
  const owned = db.query(`
    SELECT w.book_id, w.owned, w.public, w.rank, w.created_at,
           b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis
    FROM wishlist w JOIN books b ON b.id = w.book_id
    WHERE w.user_id = ? AND w.owned = 1
    ORDER BY w.rank ASC
  `).all(userId) as WishlistRow[];

  // 2. Wishlist items a friend has read
  const friends = listFriends(userId);
  const friendOwned: (WishlistRow & { friendUsername: string })[] = [];
  const seen = new Set<number>();

  if (friends.length > 0) {
    const placeholders = friends.map(() => "?").join(",");
    const friendIds = friends.map((f) => f.user_id);
    const rows = db.query(`
      SELECT w.book_id, w.owned, w.public, w.rank, w.created_at,
             b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis,
             r.user_id AS friend_user_id
      FROM wishlist w
      JOIN books b ON b.id = w.book_id
      JOIN reads r ON r.book_id = w.book_id
      WHERE w.user_id = ? AND r.user_id IN (${placeholders})
      ORDER BY w.rank ASC
    `).all(userId, ...friendIds) as (WishlistRow & { friend_user_id: number })[];

    const friendById = new Map(friends.map((f) => [f.user_id, f.username]));
    for (const row of rows) {
      if (seen.has(row.book_id)) continue;
      seen.add(row.book_id);
      friendOwned.push({ ...row, friendUsername: friendById.get(row.friend_user_id) || "" });
    }
  }

  // Combine: owned first, then friend-owned, each group in rank order
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

  // 3. Fallback to top of wishlist if nothing found
  if (combined.length === 0) {
    const top = listWishlist(userId).slice(0, limit);
    for (const row of top) {
      combined.push({ ...row, reason: "owned" });
    }
  }

  return combined;
}


export function addToWishlist(
  userId: number,
  bookId: number,
  owned?: boolean,
  isPublic?: boolean,
  rank?: number
): { ok: boolean; error?: string } {
  const existing = db.query("SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (existing) return { ok: false, error: "Already on your wishlist" };

  const max = db.query("SELECT COALESCE(MAX(rank), 0) AS m FROM wishlist WHERE user_id = ?").get(userId) as { m: number };
  const maxRank: number = max?.m ?? 0;
  let r: number;
  if (rank == null) r = maxRank + 1;
  else r = Math.min(Math.max(Math.round(rank), 1), maxRank + 1);

  tx(() => {
    if (rank != null) {
      db.query("UPDATE wishlist SET rank = rank + 1 WHERE user_id = ? AND rank >= ?").run(userId, r);
    }
    db.query("INSERT INTO wishlist (user_id, book_id, owned, public, rank) VALUES (?, ?, ?, ?, ?)")
      .run(userId, bookId, owned ? 1 : 0, isPublic ? 1 : 0, r);
  });

  return { ok: true };
}

export function removeFromWishlist(userId: number, bookId: number): void {
  db.query("DELETE FROM wishlist WHERE user_id = ? AND book_id = ?").run(userId, bookId);
  reorderWishlist(userId, wishOrderedIds(userId));
}

function wishOrderedIds(userId: number): number[] {
  return (db.query("SELECT book_id FROM wishlist WHERE user_id = ? ORDER BY rank ASC, book_id ASC")
    .all(userId) as { book_id: number }[]).map((r) => r.book_id);
}

export function reorderWishlist(userId: number, orderedBookIds: number[]): void {
  const current = wishOrderedIds(userId);
  const currentSet = new Set(current);
  const given: number[] = [];
  for (const id of orderedBookIds) {
    if (currentSet.has(id) && !given.includes(id)) given.push(id);
  }
  const givenSet = new Set(given);
  const remainder = current.filter((id) => !givenSet.has(id));
  const finalOrder = [...given, ...remainder];

  tx(() => {
    finalOrder.forEach((id, i) => {
      db.query("UPDATE wishlist SET rank = ? WHERE user_id = ? AND book_id = ?").run(i + 1, userId, id);
    });
  });
}

export function setWishRank(userId: number, bookId: number, newRank: number): { ok: boolean; error?: string } {
  const ids = wishOrderedIds(userId);
  const idx = ids.indexOf(bookId);
  if (idx < 0) return { ok: false, error: "Not on your wishlist" };
  ids.splice(idx, 1);
  const insertAt = Math.max(0, Math.min(newRank - 1, ids.length));
  ids.splice(insertAt, 0, bookId);
  reorderWishlist(userId, ids);
  return { ok: true };
}

export async function addToWishlistByOlKey(
  userId: number,
  olKey?: string,
  owned?: boolean,
  year?: number,
  isPublic?: boolean,
  rank?: number
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  if (!olKey) return { ok: false, error: "ol_key is required" };
  const book = await getOrCreateBookByKey(olKey, year);
  if (!book) return { ok: false, error: "Could not load book from Open Library" };
  const r = addToWishlist(userId, book.id, owned, isPublic, rank);
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, book };
}

export function addToWishlistByBookId(
  userId: number,
  bookId: number,
  owned?: boolean,
  isPublic?: boolean,
  rank?: number
): { ok: boolean; error?: string; book?: BookRow } {
  const book = getBookById(bookId);
  if (!book) return { ok: false, error: "Book not found" };
  const existing = db.query("SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (existing) return { ok: false, error: "You've already read this — it's on your books list" };
  const r = addToWishlist(userId, bookId, owned, isPublic, rank);
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, book };
}

export function setOwned(userId: number, bookId: number, owned: boolean): { ok: boolean; error?: string } {
  const existing = db.query("SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (!existing) return { ok: false, error: "Not on your wishlist" };
  db.query("UPDATE wishlist SET owned = ? WHERE user_id = ? AND book_id = ?").run(owned ? 1 : 0, userId, bookId);
  return { ok: true };
}

export function setReadPublic(userId: number, bookId: number, isPublic: boolean): { ok: boolean; error?: string } {
  const row = db.query("SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (!row) return { ok: false, error: "Book not on your list" };
  db.query("UPDATE reads SET public = ? WHERE user_id = ? AND book_id = ?").run(isPublic ? 1 : 0, userId, bookId);
  return { ok: true };
}

export function setWishPublic(userId: number, bookId: number, isPublic: boolean): { ok: boolean; error?: string } {
  const row = db.query("SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (!row) return { ok: false, error: "Not on your wishlist" };
  db.query("UPDATE wishlist SET public = ? WHERE user_id = ? AND book_id = ?").run(isPublic ? 1 : 0, userId, bookId);
  return { ok: true };
}

export function moveToRead(
  userId: number,
  bookId: number,
  review?: string,
  rank?: number
): { ok: boolean; error?: string } {
  const wish = db.query("SELECT public FROM wishlist WHERE user_id = ? AND book_id = ?")
    .get(userId, bookId) as { public: number } | undefined;
  if (!wish) return { ok: false, error: "Not on your wishlist" };

  const alreadyRead = db.query("SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (alreadyRead) {
    removeFromWishlist(userId, bookId);
    return { ok: true };
  }

  const r = insertReadEntry(userId, bookId, review, rank, (wish.public ?? 0) === 1);
  if (r.error) return { ok: false, error: r.error };
  removeFromWishlist(userId, bookId);
  return { ok: true };
}

export function addManualToWishlist(
  userId: number,
  fields: ManualBookFields,
  owned?: boolean,
  isPublic?: boolean,
  rank?: number
): { ok: boolean; error?: string; book?: BookRow } {
  const c = createManualBook(fields);
  if (c.error || !c.book) return { ok: false, error: c.error };
  const r = addToWishlist(userId, c.book.id, owned, isPublic, rank);
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, book: c.book };
}

export function setReview(userId: number, bookId: number, review: string): { ok: boolean; error?: string } {
  const row = db.query("SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (!row) return { ok: false, error: "Book not on your list" };
  db.query("UPDATE reads SET review = ?, updated_at = ? WHERE user_id = ? AND book_id = ?")
    .run(review, now(), userId, bookId);
  return { ok: true };
}

export function reorderReads(userId: number, orderedBookIds: number[]): void {
  const currentRaw = db.query("SELECT book_id FROM reads WHERE user_id = ? ORDER BY rank ASC")
    .all(userId) as { book_id: number }[];
  const current = currentRaw.map((r) => r.book_id);
  const currentSet = new Set(current);

  const given: number[] = [];
  for (const id of orderedBookIds) {
    if (currentSet.has(id) && !given.includes(id)) given.push(id);
  }
  const givenSet = new Set(given);
  const remainder = current.filter((id) => !givenSet.has(id));
  const finalOrder = [...given, ...remainder];

  tx(() => {
    finalOrder.forEach((id, i) => {
      db.query("UPDATE reads SET rank = ?, updated_at = ? WHERE user_id = ? AND book_id = ?")
        .run(i + 1, now(), userId, id);
    });
  });
}

export function setRank(userId: number, bookId: number, newRank: number): { ok: boolean; error?: string } {
  const currentRaw = db.query("SELECT book_id FROM reads WHERE user_id = ? ORDER BY rank ASC")
    .all(userId) as { book_id: number }[];
  const ids = currentRaw.map((r) => r.book_id);
  const idx = ids.indexOf(bookId);
  if (idx < 0) return { ok: false, error: "Book not on your list" };
  ids.splice(idx, 1);
  const insertAt = Math.max(0, Math.min(newRank - 1, ids.length));
  ids.splice(insertAt, 0, bookId);
  reorderReads(userId, ids);
  return { ok: true };
}

export function removeRead(userId: number, bookId: number): { ok: boolean } {
  db.query("DELETE FROM reads WHERE user_id = ? AND book_id = ?").run(userId, bookId);
  const remaining = db.query("SELECT book_id FROM reads WHERE user_id = ? ORDER BY rank ASC")
    .all(userId) as { book_id: number }[];
  reorderReads(userId, remaining.map((r) => r.book_id));
  return { ok: true };
}

// ---------- Currently reading (always visible to friends) ----------

export interface ReadingRow extends BookRow {
  book_id: number;
  created_at: number;
}

export function listReading(userId: number): ReadingRow[] {
  return db.query(`
    SELECT r.book_id, r.created_at,
           b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis
    FROM reading r JOIN books b ON b.id = r.book_id
    WHERE r.user_id = ? ORDER BY r.created_at DESC, r.book_id DESC
  `).all(userId) as ReadingRow[];
}

export function addToReadingByBookId(
  userId: number,
  bookId: number,
  wishlistState?: { rank: number; owned: number; public: number }
): { ok: boolean; error?: string; book?: BookRow } {
  const book = getBookById(bookId);
  if (!book) return { ok: false, error: "Book not found" };
  const existing = db.query("SELECT 1 FROM reading WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (existing) return { ok: false, error: "Already currently reading" };
  if (wishlistState) {
    db.query("INSERT INTO reading (user_id, book_id, wishlist_rank, wishlist_owned, wishlist_public) VALUES (?, ?, ?, ?, ?)")
      .run(userId, bookId, wishlistState.rank, wishlistState.owned, wishlistState.public);
  } else {
    db.query("INSERT INTO reading (user_id, book_id) VALUES (?, ?)").run(userId, bookId);
  }
  return { ok: true, book };
}

export function moveFromWishlistToReading(userId: number, bookId: number): { ok: boolean; error?: string; book?: BookRow } {
  const wishItem = db.query("SELECT rank, owned, public FROM wishlist WHERE user_id = ? AND book_id = ?")
    .get(userId, bookId) as { rank: number; owned: number; public: number } | undefined;
  if (!wishItem) return { ok: false, error: "Book not on your wishlist" };
  
  const r = addToReadingByBookId(userId, bookId, wishItem);
  if (r.error) return r;
  
  removeFromWishlist(userId, bookId);
  return r;
}

export async function addToReadingByOlKey(
  userId: number,
  olKey?: string,
  year?: number
): Promise<{ ok: boolean; error?: string; book?: BookRow }> {
  if (!olKey) return { ok: false, error: "ol_key is required" };
  const book = await getOrCreateBookByKey(olKey, year);
  if (!book) return { ok: false, error: "Could not load book from Open Library" };
  return addToReadingByBookId(userId, book.id);
}

export function addManualToReading(
  userId: number,
  fields: ManualBookFields
): { ok: boolean; error?: string; book?: BookRow } {
  const c = createManualBook(fields);
  if (c.error || !c.book) return { ok: false, error: c.error };
  return addToReadingByBookId(userId, c.book.id);
}

export function removeFromReading(userId: number, bookId: number, skipWishlistRestore = false): void {
  // Check if this book has saved wishlist state to restore
  const reading = db.query("SELECT wishlist_rank, wishlist_owned, wishlist_public FROM reading WHERE user_id = ? AND book_id = ?")
    .get(userId, bookId) as { wishlist_rank: number | null; wishlist_owned: number | null; wishlist_public: number | null } | undefined;
  
  db.query("DELETE FROM reading WHERE user_id = ? AND book_id = ?").run(userId, bookId);
  
  // If we have saved wishlist state, the book isn't already on wishlist, and we're not skipping restore
  if (!skipWishlistRestore && reading && reading.wishlist_rank != null) {
    const onWishlist = db.query("SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?").get(userId, bookId);
    if (!onWishlist) {
      // Shift existing books at or after the saved rank down by one
      db.query("UPDATE wishlist SET rank = rank + 1 WHERE user_id = ? AND rank >= ?")
        .run(userId, reading.wishlist_rank);
      
      // Now insert the restored book at its original rank
      db.query("INSERT INTO wishlist (user_id, book_id, rank, owned, public) VALUES (?, ?, ?, ?, ?)")
        .run(userId, bookId, reading.wishlist_rank, reading.wishlist_owned || 0, reading.wishlist_public || 0);
    }
  }
}

export function finishReading(
  userId: number,
  bookId: number,
  review?: string,
  rank?: number
): { ok: boolean; error?: string } {
  const cur = db.query("SELECT 1 FROM reading WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (!cur) return { ok: false, error: "Not currently reading" };
  const alreadyRead = db.query("SELECT 1 FROM reads WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  if (!alreadyRead) {
    const r = insertReadEntry(userId, bookId, review, rank);
    if (r.error) return { ok: false, error: r.error };
  }
  removeFromReading(userId, bookId, true); // Don't restore to wishlist - book is now "read"
  return { ok: true };
}

export function backToWishlist(userId: number, bookId: number): { ok: boolean; error?: string } {
  const cur = db.query("SELECT wishlist_rank, wishlist_owned, wishlist_public FROM reading WHERE user_id = ? AND book_id = ?")
    .get(userId, bookId) as { wishlist_rank: number | null; wishlist_owned: number | null; wishlist_public: number | null } | undefined;
  if (!cur) return { ok: false, error: "Not currently reading" };
  
  // Check if already on wishlist
  const onWishlist = db.query("SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?").get(userId, bookId);
  
  if (!onWishlist) {
    // If we have saved wishlist state, restore with that state
    if (cur.wishlist_rank != null) {
      // Shift existing books at or after the saved rank down by one
      db.query("UPDATE wishlist SET rank = rank + 1 WHERE user_id = ? AND rank >= ?")
        .run(userId, cur.wishlist_rank);
      
      // Now insert the restored book at its original rank
      db.query("INSERT INTO wishlist (user_id, book_id, rank, owned, public) VALUES (?, ?, ?, ?, ?)")
        .run(userId, bookId, cur.wishlist_rank, cur.wishlist_owned || 0, cur.wishlist_public || 0);
    } else {
      // Otherwise add with defaults
      const r = addToWishlist(userId, bookId, false, false);
      if (r.error) return { ok: false, error: r.error };
    }
  }
  
  removeFromReading(userId, bookId, true); // Skip auto-restore since we handled it above
  return { ok: true };
}

export function getFriendReading(
  viewerId: number,
  friendUsername: string
): { ok: boolean; error?: string; user?: { id: number; username: string }; books?: ReadingRow[] } {
  const friend = db.query("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
    .get(friendUsername) as { id: number; username: string } | undefined;
  if (!friend) return { ok: false, error: "User not found" };
  if (friend.id === viewerId) return { ok: false, error: "That's you — use your own list" };
  if (!isFriend(viewerId, friend.id)) return { ok: false, error: "You are not friends with this user" };
  const mine = viewerOwnership(viewerId);
  const books = listReading(friend.id).map((b) => ({ ...b, mine: mineStatus(mine, b.book_id) }));
  return { ok: true, user: friend, books };
}

// ---------- Friends ----------

export interface FriendRequestRow {
  id: number;
  user_id: number;
  username: string;
}

export function sendFriendRequest(
  requesterId: number,
  identifier: string
): { ok: boolean; error?: string; username?: string; autoAccepted?: boolean } {
  const target = findUser(String(identifier).trim());
  if (!target) return { ok: false, error: "User not found" };
  if (target.id === requesterId) return { ok: false, error: "You can't add yourself" };

  const existing = db.query(
    "SELECT * FROM friendships WHERE (requester_id = ? AND requestee_id = ?) OR (requester_id = ? AND requestee_id = ?)"
  ).get(requesterId, target.id, target.id, requesterId) as any;

  if (existing) {
    if (existing.status === "accepted") return { ok: false, error: "You are already friends" };
    if (existing.requester_id === requesterId) return { ok: false, error: "Friend request already sent" };
    // The other person already requested us — accept on their behalf.
    db.query("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(existing.id);
    return { ok: true, autoAccepted: true, username: target.username };
  }

  db.query("INSERT INTO friendships (requester_id, requestee_id, status) VALUES (?, ?, 'pending')")
    .run(requesterId, target.id);
  return { ok: true, username: target.username };
}

export function listFriendRequests(userId: number): { incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] } {
  const incoming = db.query(`
    SELECT f.id, u.id AS user_id, u.username
    FROM friendships f JOIN users u ON u.id = f.requester_id
    WHERE f.requestee_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).all(userId) as FriendRequestRow[];
  const outgoing = db.query(`
    SELECT f.id, u.id AS user_id, u.username
    FROM friendships f JOIN users u ON u.id = f.requestee_id
    WHERE f.requester_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).all(userId) as FriendRequestRow[];
  return { incoming, outgoing };
}

export function acceptFriendRequest(userId: number, requestId: number): { ok: boolean; error?: string } {
  const f = db.query("SELECT 1 FROM friendships WHERE id = ? AND requestee_id = ? AND status = 'pending'")
    .get(requestId, userId);
  if (!f) return { ok: false, error: "Request not found" };
  db.query("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(requestId);
  return { ok: true };
}

export function declineFriendRequest(userId: number, requestId: number): { ok: boolean; error?: string } {
  db.query("DELETE FROM friendships WHERE id = ? AND requestee_id = ? AND status = 'pending'")
    .run(requestId, userId);
  return { ok: true };
}

export function listFriends(userId: number): { user_id: number; username: string }[] {
  return db.query(`
    SELECT u.id AS user_id, u.username
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.requestee_id ELSE f.requester_id END
    WHERE (f.requester_id = ? OR f.requestee_id = ?) AND f.status = 'accepted'
    ORDER BY u.username COLLATE NOCASE
  `).all(userId, userId, userId) as { user_id: number; username: string }[];
}

export function removeFriend(userId: number, friendId: number): void {
  db.query(
    "DELETE FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND requestee_id = ?) OR (requester_id = ? AND requestee_id = ?))"
  ).run(userId, friendId, friendId, userId);
}

export function isFriend(a: number, b: number): boolean {
  return !!db.query(
    "SELECT 1 FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND requestee_id = ?) OR (requester_id = ? AND requestee_id = ?))"
  ).get(a, b, b, a);
}

type MineStatus = "read" | "wish" | "reading" | null;

function viewerOwnership(viewerId: number): { reads: Set<number>; wish: Set<number>; reading: Set<number> } {
  const reads = new Set(
    (db.query("SELECT book_id FROM reads WHERE user_id = ?").all(viewerId) as { book_id: number }[]).map((r) => r.book_id)
  );
  const wish = new Set(
    (db.query("SELECT book_id FROM wishlist WHERE user_id = ?").all(viewerId) as { book_id: number }[]).map((r) => r.book_id)
  );
  const reading = new Set(
    (db.query("SELECT book_id FROM reading WHERE user_id = ?").all(viewerId) as { book_id: number }[]).map((r) => r.book_id)
  );
  return { reads, wish, reading };
}

function mineStatus(
  o: { reads: Set<number>; wish: Set<number>; reading: Set<number> },
  bookId: number
): MineStatus {
  return o.reading.has(bookId) ? "reading" : o.reads.has(bookId) ? "read" : o.wish.has(bookId) ? "wish" : null;
}

export function getFriendReads(
  viewerId: number,
  friendUsername: string
): { ok: boolean; error?: string; user?: { id: number; username: string }; books?: ReadRow[] } {
  const friend = db.query("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
    .get(friendUsername) as { id: number; username: string } | undefined;
  if (!friend) return { ok: false, error: "User not found" };
  if (friend.id === viewerId) return { ok: false, error: "That's you — use your own list" };
  if (!isFriend(viewerId, friend.id)) return { ok: false, error: "You are not friends with this user" };

  const mine = viewerOwnership(viewerId);
  const books = listReads(friend.id, true).map((b) => ({ ...b, mine: mineStatus(mine, b.book_id) }));
  return { ok: true, user: friend, books };
}

export function getFriendWishlist(
  viewerId: number,
  friendUsername: string
): { ok: boolean; error?: string; user?: { id: number; username: string }; books?: WishlistRow[] } {
  const friend = db.query("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
    .get(friendUsername) as { id: number; username: string } | undefined;
  if (!friend) return { ok: false, error: "User not found" };
  if (friend.id === viewerId) return { ok: false, error: "That's you — use your own wishlist" };
  if (!isFriend(viewerId, friend.id)) return { ok: false, error: "You are not friends with this user" };

  const mine = viewerOwnership(viewerId);
  const books = listWishlist(friend.id, true).map((b) => ({ ...b, mine: mineStatus(mine, b.book_id) }));
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

export function getBookDetail(viewerId: number, bookId: number): BookDetail | null {
  const book = getBookById(bookId);
  if (!book) return null;

  // Get all friends who have this book
  const friends = listFriends(viewerId);
  const activities: FriendActivity[] = [];

  for (const friend of friends) {
    // Check if friend has it in reads
    const read = db.query(
      "SELECT review, rank FROM reads WHERE user_id = ? AND book_id = ? AND public = 1"
    ).get(friend.user_id, bookId) as { review: string | null; rank: number } | undefined;
    
    if (read) {
      activities.push({
        username: friend.username,
        review: read.review,
        rank: read.rank,
        owned: 0,
        status: "read",
      });
    }

    // Check if friend has it in wishlist
    const wish = db.query(
      "SELECT owned FROM wishlist WHERE user_id = ? AND book_id = ? AND public = 1"
    ).get(friend.user_id, bookId) as { owned: number } | undefined;
    
    if (wish) {
      activities.push({
        username: friend.username,
        review: null,
        rank: null,
        owned: wish.owned,
        status: "wishlist",
      });
    }

    // Check if friend is currently reading it
    const reading = db.query(
      "SELECT 1 FROM reading WHERE user_id = ? AND book_id = ?"
    ).get(friend.user_id, bookId);
    
    if (reading) {
      activities.push({
        username: friend.username,
        review: null,
        rank: null,
        owned: 0,
        status: "reading",
      });
    }
  }

  return { ...book, friends: activities };
}

// Backfill synopsis for books that don't have one
export async function backfillSynopses(): Promise<{ updated: number; failed: number }> {
  const books = db.query(
    "SELECT id, ol_key FROM books WHERE synopsis IS NULL AND ol_key NOT LIKE 'manual:%'"
  ).all() as { id: number; ol_key: string }[];

  let updated = 0;
  let failed = 0;

  for (const book of books) {
    try {
      const { fetchSynopsis } = await import("./ol");
      const synopsis = await fetchSynopsis(book.ol_key);
      if (synopsis) {
        db.query("UPDATE books SET synopsis = ? WHERE id = ?").run(synopsis, book.id);
        updated++;
      }
    } catch {
      failed++;
    }
  }

  return { updated, failed };
}

// ---------- Discover candidates ----------

export interface DiscoverBook {
  id: string;
  ol_key: string;
  title: string;
  author: string;
  cover_url: string | null;
  synopsis: string | null;
  genres: string[];
  themes: string[];
  mood: string[];
  length: "short" | "medium" | "long";
  era: "classic" | "modern" | "contemporary";
  complexity: "light" | "moderate" | "dense";
}

// Fetch subjects from OpenLibrary for a work
async function fetchOLSubjects(olKey: string): Promise<string[]> {
  try {
    const res = await fetch(`https://openlibrary.org${olKey}.json`);
    if (!res.ok) return [];
    const data = await res.json();
    const subjects = data.subjects || [];
    return Array.isArray(subjects) ? subjects : [];
  } catch {
    return [];
  }
}

// Map OpenLibrary subjects to our feature tags
function mapSubjectsToFeatures(subjects: string[]): {
  genres: string[];
  themes: string[];
  mood: string[];
} {
  const genres: Set<string> = new Set();
  const themes: Set<string> = new Set();
  const mood: Set<string> = new Set();

  // Subject → feature mappings
  const genreMap: Record<string, string> = {
    "science fiction": "sci-fi",
    "fantasy": "fantasy",
    "mystery": "mystery",
    "thriller": "thriller",
    "romance": "romance",
    "horror": "horror",
    "historical fiction": "historical-fiction",
    "literature": "literary-fiction",
    "biography": "biography",
    "autobiography": "memoir",
    "memoir": "memoir",
    "history": "history",
    "philosophy": "philosophy",
    "science": "science",
    "psychology": "psychology",
    "self-help": "self-help",
    "travel": "adventure",
    "adventure": "adventure",
    "crime": "mystery",
    "detective": "mystery",
    "poetry": "poetry",
    "essays": "essays",
    "humor": "comedy",
    "satire": "comedy",
    "dystopia": "sci-fi",
    "utopia": "sci-fi",
  };

  const themeMap: Record<string, string> = {
    "love": "love",
    "war": "war",
    "politics": "politics",
    "religion": "religion",
    "death": "death",
    "friendship": "friendship",
    "family": "family",
    "identity": "identity",
    "freedom": "freedom",
    "justice": "justice",
    "power": "power",
    "corruption": "corruption",
    "survival": "survival",
    "magic": "magic",
    "technology": "technology",
    "artificial intelligence": "technology",
    "space": "space",
    "time travel": "time",
    "immigration": "immigration",
    "slavery": "slavery",
    "colonialism": "colonialism",
    "feminism": "feminism",
    "mental health": "mental-health",
    "addiction": "addiction",
    "grief": "grief",
    "coming of age": "coming-of-age",
    "memory": "memory",
    "trauma": "trauma",
    "politics and government": "politics",
    "social classes": "class",
    "marriage": "marriage",
    "divorce": "marriage",
    "parenting": "family",
    "motherhood": "motherhood",
    "fatherhood": "fatherhood",
    "orphan": "isolation",
    "loneliness": "loneliness",
  };

  const moodMap: Record<string, string> = {
    "dark": "dark",
    "light": "uplifting",
    "humorous": "humorous",
    "funny": "humorous",
    "sad": "melancholic",
    "depressing": "dark",
    "uplifting": "uplifting",
    "inspiring": "inspirational",
    "thought-provoking": "thought-provoking",
    "philosophical": "thought-provoking",
    "suspenseful": "gripping",
    "exciting": "exciting",
    "romantic": "romantic",
    "beautiful": "beautiful",
    "lyrical": "lyrical",
    "gothic": "gothic",
    "eerie": "eerie",
    "creepy": "creepy",
    "disturbing": "dark",
    "bleak": "dark",
    "hopeful": "uplifting",
    "optimistic": "uplifting",
    "pessimistic": "dark",
    "cynical": "dark",
    "satirical": "satirical",
    "absurd": "absurd",
    "whimsical": "whimsical",
    "wholesome": "uplifting",
    "heartwarming": "uplifting",
    "tragic": "tragic",
    "haunting": "haunting",
    "atmospheric": "atmospheric",
    "epic": "epic",
    "intimate": "intimate",
    "contemplative": "contemplative",
    "meditative": "contemplative",
    "fast-paced": "gripping",
    "slow": "contemplative",
  };

  for (const subject of subjects) {
    const s = subject.toLowerCase().trim();

    // Check genre mapping
    for (const [key, value] of Object.entries(genreMap)) {
      if (s.includes(key)) {
        genres.add(value);
      }
    }

    // Check theme mapping
    for (const [key, value] of Object.entries(themeMap)) {
      if (s.includes(key)) {
        themes.add(value);
      }
    }

    // Check mood mapping
    for (const [key, value] of Object.entries(moodMap)) {
      if (s.includes(key)) {
        mood.add(value);
      }
    }
  }

  return {
    genres: Array.from(genres).slice(0, 3), // Limit to top 3
    themes: Array.from(themes).slice(0, 4), // Limit to top 4
    mood: Array.from(mood).slice(0, 4), // Limit to top 4
  };
}

// Estimate book length from synopsis length or default to medium
function estimateLength(synopsis: string | null): "short" | "medium" | "long" {
  if (!synopsis) return "medium";
  const len = synopsis.length;
  if (len < 200) return "short";
  if (len > 500) return "long";
  return "medium";
}

// Determine era from publication year
function determineEra(year: number | null): "classic" | "modern" | "contemporary" {
  if (!year) return "contemporary";
  if (year < 1950) return "classic";
  if (year < 2000) return "modern";
  return "contemporary";
}

// Estimate complexity from synopsis or default to moderate
function estimateComplexity(synopsis: string | null): "light" | "moderate" | "dense" {
  if (!synopsis) return "moderate";
  // Simple heuristic: shorter synopses might indicate simpler books
  const len = synopsis.length;
  if (len < 150) return "light";
  if (len > 600) return "dense";
  return "moderate";
}

export async function getDiscoverCandidates(userId: number): Promise<DiscoverBook[]> {
  // Get all books the user has interacted with
  const readBooks = listReads(userId);
  const wishlistBooks = listWishlist(userId);
  const readingBooks = listReading(userId);
  
  const readBookIds = new Set(readBooks.map(b => b.book_id));
  const wishlistBookIds = new Set(wishlistBooks.map(b => b.book_id));
  const readingBookIds = new Set(readingBooks.map(b => b.book_id));
  
  // Combine all excluded IDs
  const excludedBookIds = new Set([...readBookIds, ...wishlistBookIds, ...readingBookIds]);

  // Get all books in the database (including cached subjects)
  const allBooks = db
    .query(
      "SELECT id, ol_key, title, author, cover_url, first_publish_year, synopsis, subjects FROM books ORDER BY id DESC LIMIT 200"
    )
    .all() as Array<{
    id: number;
    ol_key: string;
    title: string;
    author: string | null;
    cover_url: string | null;
    first_publish_year: number | null;
    synopsis: string | null;
    subjects: string | null;
  }>;

  // Filter to books the user hasn't read, wishlisted, or is currently reading
  const unreadBooks = allBooks.filter(b => !excludedBookIds.has(b.id));

  // Enrich each book with features
  const candidates: DiscoverBook[] = [];

  for (const book of unreadBooks.slice(0, 100)) {
    // Skip manual books (no OL data)
    if (book.ol_key.startsWith("manual:")) continue;

    // Use cached subjects if available, otherwise fetch from OpenLibrary
    let subjects: string[];
    if (book.subjects) {
      subjects = JSON.parse(book.subjects);
    } else {
      subjects = await fetchOLSubjects(book.ol_key);
      // Cache the subjects
      db.query("UPDATE books SET subjects = ? WHERE id = ?")
        .run(JSON.stringify(subjects), book.id);
    }

    // Map subjects to features
    const features = mapSubjectsToFeatures(subjects);

    // If we couldn't extract any features, skip this book
    if (features.genres.length === 0 && features.themes.length === 0 && features.mood.length === 0) {
      continue;
    }

    candidates.push({
      id: String(book.id),
      ol_key: book.ol_key,
      title: book.title,
      author: book.author || "Unknown",
      cover_url: book.cover_url,
      synopsis: book.synopsis,
      genres: features.genres,
      themes: features.themes,
      mood: features.mood,
      length: estimateLength(book.synopsis),
      era: determineEra(book.first_publish_year),
      complexity: estimateComplexity(book.synopsis),
    });
  }

  return candidates;
}
