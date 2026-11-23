import { execute, now, queryAll, queryOne } from "../db";
import { BOOK_COLUMNS, type BookRef, type BookRow, resolveBook } from "./books";
import { FRIEND_IDS } from "./friends";
import { fail, notFound, type Result } from "./result";
import { getBookAllowance } from "./users";

interface ListRow extends BookRow {
  book_id: number;
  category_ids: number[];
  created_at: number;
}

export interface ReadRow extends ListRow {
  rank: number;
  review: string | null;
  public: number;
  listened: number;
  updated_at: number;
}

export interface WishlistRow extends ListRow {
  owned: number;
  public: number;
  rank: number;
}

export interface ReadingRow extends ListRow {
  listening: number;
}

export interface NextUpRow extends WishlistRow {
  reason: "owned" | "friend";
  friendUsername?: string;
}

type List = "reads" | "wishlist" | "reading";
type RankedList = "reads" | "wishlist";

// Wishlist settings a book had before it moved to reading, so "back to
// wishlist" can put it where it was.
interface WishlistState {
  rank: number;
  owned: number;
  public: number;
}

async function onList(db: D1Database, list: List, userId: number, bookId: number): Promise<boolean> {
  return !!(await queryOne(db, `SELECT 1 FROM ${list} WHERE user_id = ? AND book_id = ?`, userId, bookId));
}

// ---------- Categories on list rows ----------

// The categories of a list row aliased l, for queryWithCategories.
const CATEGORY_IDS = `(SELECT json_group_array(cb.category_id) FROM category_books cb
  WHERE cb.user_id = l.user_id AND cb.book_id = l.book_id) AS category_ids`;

async function queryWithCategories<T extends { category_ids: number[] }>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const rows = await queryAll<Omit<T, "category_ids"> & { category_ids: string }>(db, sql, ...params);
  return rows.map((r) => ({ ...r, category_ids: JSON.parse(r.category_ids) }) as unknown as T);
}

// Categories follow a book between lists, so they go once it is on none of them.
// Moves must add to the new list before removing from the old one.
async function pruneCategories(db: D1Database, userId: number, bookId: number): Promise<void> {
  await execute(
    db,
    `DELETE FROM category_books WHERE user_id = ?1 AND book_id = ?2
       AND NOT EXISTS (SELECT 1 FROM reads WHERE user_id = ?1 AND book_id = ?2)
       AND NOT EXISTS (SELECT 1 FROM wishlist WHERE user_id = ?1 AND book_id = ?2)
       AND NOT EXISTS (SELECT 1 FROM reading WHERE user_id = ?1 AND book_id = ?2)`,
    userId,
    bookId,
  );
}

// ---------- Ranked lists (reads and wishlist share ordering rules) ----------

export async function rankedIds(db: D1Database, list: RankedList, userId: number): Promise<number[]> {
  const rows = await queryAll<{ book_id: number }>(
    db,
    `SELECT book_id FROM ${list} WHERE user_id = ? ORDER BY rank ASC, book_id ASC`,
    userId,
  );
  return rows.map((r) => r.book_id);
}

export async function writeRanks(db: D1Database, list: RankedList, userId: number, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const touch = list === "reads" ? `, updated_at = ${now()}` : "";
  await db.batch(
    ids.map((id, i) =>
      db.prepare(`UPDATE ${list} SET rank = ?${touch} WHERE user_id = ? AND book_id = ?`).bind(i + 1, userId, id),
    ),
  );
}

// The requested ids come first in the given order; anything left out keeps
// its relative position after them. Unknown or repeated ids are ignored.
export function requestedOrder(current: number[], requested: number[]): number[] {
  const given = [...new Set(requested)].filter((id) => current.includes(id));
  return [...given, ...current.filter((id) => !given.includes(id))];
}

export async function reorderList(
  db: D1Database,
  list: RankedList,
  userId: number,
  requested: number[],
): Promise<void> {
  await writeRanks(db, list, userId, requestedOrder(await rankedIds(db, list, userId), requested));
}

// Inserts at the requested rank (shifting the rest down), or at the end.
async function insertRanked(
  db: D1Database,
  list: RankedList,
  userId: number,
  bookId: number,
  rank: number | undefined,
  columns: Record<string, string | number | null>,
): Promise<void> {
  const max = await queryOne<{ m: number }>(
    db,
    `SELECT COALESCE(MAX(rank), 0) AS m FROM ${list} WHERE user_id = ?`,
    userId,
  );
  const last = (max?.m ?? 0) + 1;
  const at = rank == null ? last : Math.min(Math.max(Math.round(rank), 1), last);
  const names = ["user_id", "book_id", "rank", ...Object.keys(columns)];
  await db.batch([
    db.prepare(`UPDATE ${list} SET rank = rank + 1 WHERE user_id = ? AND rank >= ?`).bind(userId, at),
    db
      .prepare(`INSERT INTO ${list} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
      .bind(userId, bookId, at, ...Object.values(columns)),
  ]);
}

async function removeRanked(db: D1Database, list: RankedList, userId: number, bookId: number): Promise<void> {
  await execute(db, `DELETE FROM ${list} WHERE user_id = ? AND book_id = ?`, userId, bookId);
  await pruneCategories(db, userId, bookId);
  await writeRanks(db, list, userId, await rankedIds(db, list, userId));
}

export async function setVisibility(
  db: D1Database,
  list: RankedList,
  userId: number,
  bookId: number,
  isPublic: boolean,
): Promise<Result> {
  const r = await execute(
    db,
    `UPDATE ${list} SET public = ? WHERE user_id = ? AND book_id = ?`,
    isPublic ? 1 : 0,
    userId,
    bookId,
  );
  return r.meta.changes ? { ok: true } : notFound(list === "reads" ? "Book not on your list" : "Not on your wishlist");
}

// ---------- Reads ----------

export async function listReads(db: D1Database, userId: number, publicOnly = false): Promise<ReadRow[]> {
  return await queryWithCategories<ReadRow>(
    db,
    `SELECT l.book_id, l.rank, l.review, l.public, l.listened, l.created_at, l.updated_at, ${BOOK_COLUMNS}, ${CATEGORY_IDS}
     FROM reads l JOIN books b ON b.id = l.book_id
     WHERE l.user_id = ? ${publicOnly ? "AND l.public = 1" : ""} ORDER BY l.rank ASC`,
    userId,
  );
}

interface ReadOptions {
  review?: string;
  rank?: number;
  isPublic?: boolean;
  listened?: boolean;
}

async function insertRead(db: D1Database, userId: number, bookId: number, opts: ReadOptions = {}): Promise<Result> {
  if (await onList(db, "reads", userId, bookId)) return fail("This book is already on your list");
  await insertRanked(db, "reads", userId, bookId, opts.rank, {
    review: opts.review ?? null,
    public: opts.isPublic === false ? 0 : 1,
    listened: opts.listened ? 1 : 0,
  });
  return { ok: true };
}

// For a book finished from another list, which may be a reread.
async function ensureRead(db: D1Database, userId: number, bookId: number, opts: ReadOptions): Promise<Result> {
  if (await onList(db, "reads", userId, bookId)) return { ok: true };
  return await insertRead(db, userId, bookId, opts);
}

export async function addRead(
  db: D1Database,
  userId: number,
  ref: BookRef,
  opts: ReadOptions = {},
): Promise<Result<{ book: BookRow }>> {
  const r = await resolveBook(db, ref);
  if (!r.ok) return r;
  const added = await insertRead(db, userId, r.book.id, opts);
  return added.ok ? r : added;
}

export async function setRank(db: D1Database, userId: number, bookId: number, rank: number): Promise<Result> {
  const ids = await rankedIds(db, "reads", userId);
  if (!ids.includes(bookId)) return notFound("Book not on your list");
  const rest = ids.filter((id) => id !== bookId);
  rest.splice(Math.max(0, Math.min(rank - 1, rest.length)), 0, bookId);
  await writeRanks(db, "reads", userId, rest);
  return { ok: true };
}

export async function setReview(db: D1Database, userId: number, bookId: number, review: string): Promise<Result> {
  const r = await execute(
    db,
    "UPDATE reads SET review = ?, updated_at = ? WHERE user_id = ? AND book_id = ?",
    review,
    now(),
    userId,
    bookId,
  );
  return r.meta.changes ? { ok: true } : notFound("Book not on your list");
}

export async function setListened(db: D1Database, userId: number, bookId: number, listened: boolean): Promise<Result> {
  const r = await execute(
    db,
    "UPDATE reads SET listened = ? WHERE user_id = ? AND book_id = ?",
    listened ? 1 : 0,
    userId,
    bookId,
  );
  return r.meta.changes ? { ok: true } : notFound("Book not on your list");
}

export async function removeRead(db: D1Database, userId: number, bookId: number): Promise<void> {
  await removeRanked(db, "reads", userId, bookId);
}

// ---------- Wishlist ----------

export async function listWishlist(db: D1Database, userId: number, publicOnly = false): Promise<WishlistRow[]> {
  return await queryWithCategories<WishlistRow>(
    db,
    `SELECT l.book_id, l.owned, l.public, l.rank, l.created_at, ${BOOK_COLUMNS}, ${CATEGORY_IDS}
     FROM wishlist l JOIN books b ON b.id = l.book_id
     WHERE l.user_id = ? ${publicOnly ? "AND l.public = 1" : ""} ORDER BY l.rank ASC`,
    userId,
  );
}

interface WishOptions {
  owned?: boolean;
  isPublic?: boolean;
  rank?: number;
}

async function insertWish(db: D1Database, userId: number, bookId: number, opts: WishOptions = {}): Promise<Result> {
  if (await onList(db, "wishlist", userId, bookId)) return fail("Already on your wishlist");
  await insertRanked(db, "wishlist", userId, bookId, opts.rank, {
    owned: opts.owned ? 1 : 0,
    public: opts.isPublic === false ? 0 : 1,
  });
  return { ok: true };
}

export async function addToWishlist(
  db: D1Database,
  userId: number,
  ref: BookRef,
  opts: WishOptions = {},
): Promise<Result<{ book: BookRow }>> {
  const r = await resolveBook(db, ref);
  if (!r.ok) return r;
  if (await onList(db, "reads", userId, r.book.id)) return fail("You've already read this — it's on your books list");
  const added = await insertWish(db, userId, r.book.id, opts);
  return added.ok ? r : added;
}

export async function setOwned(db: D1Database, userId: number, bookId: number, owned: boolean): Promise<Result> {
  const r = await execute(
    db,
    "UPDATE wishlist SET owned = ? WHERE user_id = ? AND book_id = ?",
    owned ? 1 : 0,
    userId,
    bookId,
  );
  return r.meta.changes ? { ok: true } : notFound("Not on your wishlist");
}

export async function removeFromWishlist(db: D1Database, userId: number, bookId: number): Promise<void> {
  await removeRanked(db, "wishlist", userId, bookId);
}

export async function moveToRead(
  db: D1Database,
  userId: number,
  bookId: number,
  opts: ReadOptions = {},
): Promise<Result> {
  const wish = await queryOne<{ public: number }>(
    db,
    "SELECT public FROM wishlist WHERE user_id = ? AND book_id = ?",
    userId,
    bookId,
  );
  if (!wish) return notFound("Not on your wishlist");
  const r = await ensureRead(db, userId, bookId, { ...opts, isPublic: wish.public === 1 });
  if (!r.ok) return r;
  await removeFromWishlist(db, userId, bookId);
  return { ok: true };
}

// The top wishlist pick: owned books first, then ones a friend has read,
// falling back to the top of the wishlist.
export async function getNextUp(db: D1Database, userId: number): Promise<NextUpRow[]> {
  const wish = await listWishlist(db, userId);
  if (wish.length === 0) return [];
  const owned = wish.find((w) => w.owned);
  if (owned) return [{ ...owned, reason: "owned" }];

  const readByFriend = await queryAll<{ book_id: number; username: string }>(
    db,
    `SELECT r.book_id, u.username FROM reads r JOIN users u ON u.id = r.user_id
     WHERE r.user_id IN (${FRIEND_IDS}) AND r.book_id IN (SELECT book_id FROM wishlist WHERE user_id = ?1)
     ORDER BY u.username COLLATE NOCASE`,
    userId,
  );
  const friendOf = new Map<number, string>();
  for (const r of readByFriend) if (!friendOf.has(r.book_id)) friendOf.set(r.book_id, r.username);
  const friendPick = wish.find((w) => friendOf.has(w.book_id));
  if (friendPick) return [{ ...friendPick, reason: "friend", friendUsername: friendOf.get(friendPick.book_id) }];
  return [{ ...wish[0], reason: "owned" }];
}

// ---------- Currently reading ----------

export async function listReading(db: D1Database, userId: number): Promise<ReadingRow[]> {
  return await queryWithCategories<ReadingRow>(
    db,
    `SELECT l.book_id, l.listening, l.created_at, ${BOOK_COLUMNS}, ${CATEGORY_IDS}
     FROM reading l JOIN books b ON b.id = l.book_id
     WHERE l.user_id = ? ORDER BY l.created_at DESC, l.book_id DESC`,
    userId,
  );
}

async function insertReading(db: D1Database, userId: number, bookId: number, from?: WishlistState): Promise<Result> {
  if (await onList(db, "reading", userId, bookId)) return fail("Already currently reading");
  await execute(
    db,
    "INSERT INTO reading (user_id, book_id, wishlist_rank, wishlist_owned, wishlist_public) VALUES (?, ?, ?, ?, ?)",
    userId,
    bookId,
    from?.rank ?? null,
    from?.owned ?? null,
    from?.public ?? null,
  );
  return { ok: true };
}

export async function addToReading(db: D1Database, userId: number, ref: BookRef): Promise<Result<{ book: BookRow }>> {
  const r = await resolveBook(db, ref);
  if (!r.ok) return r;
  if (await onList(db, "wishlist", userId, r.book.id)) return await moveFromWishlistToReading(db, userId, r.book.id);
  const added = await insertReading(db, userId, r.book.id);
  return added.ok ? r : added;
}

export async function moveFromWishlistToReading(
  db: D1Database,
  userId: number,
  bookId: number,
): Promise<Result<{ book: BookRow }>> {
  const wish = await queryOne<WishlistState>(
    db,
    "SELECT rank, owned, public FROM wishlist WHERE user_id = ? AND book_id = ?",
    userId,
    bookId,
  );
  if (!wish) return notFound("Book not on your wishlist");
  const r = await resolveBook(db, { bookId });
  if (!r.ok) return r;
  // Starting a wishlist book used to leave it on both lists.
  if (!(await onList(db, "reading", userId, bookId))) {
    const added = await insertReading(db, userId, bookId, wish);
    if (!added.ok) return added;
  }
  await removeFromWishlist(db, userId, bookId);
  return r;
}

async function readingState(db: D1Database, userId: number, bookId: number) {
  return await queryOne<{
    wishlist_rank: number | null;
    wishlist_owned: number | null;
    wishlist_public: number | null;
  }>(
    db,
    "SELECT wishlist_rank, wishlist_owned, wishlist_public FROM reading WHERE user_id = ? AND book_id = ?",
    userId,
    bookId,
  );
}

// Puts a book that came off the wishlist back where it was.
async function restoreToWishlist(
  db: D1Database,
  userId: number,
  bookId: number,
  state: NonNullable<Awaited<ReturnType<typeof readingState>>>,
): Promise<Result> {
  if (await onList(db, "wishlist", userId, bookId)) return { ok: true };
  return await insertWish(db, userId, bookId, {
    rank: state.wishlist_rank ?? undefined,
    owned: !!state.wishlist_owned,
    isPublic: state.wishlist_public !== 0,
  });
}

async function deleteReading(db: D1Database, userId: number, bookId: number): Promise<void> {
  await execute(db, "DELETE FROM reading WHERE user_id = ? AND book_id = ?", userId, bookId);
  await pruneCategories(db, userId, bookId);
}

// Dropping a book that came from the wishlist returns it there.
export async function removeFromReading(db: D1Database, userId: number, bookId: number): Promise<void> {
  const state = await readingState(db, userId, bookId);
  if (state?.wishlist_rank != null) await restoreToWishlist(db, userId, bookId, state);
  await deleteReading(db, userId, bookId);
}

export async function finishReading(
  db: D1Database,
  userId: number,
  bookId: number,
  opts: ReadOptions = {},
): Promise<Result> {
  const reading = await queryOne<{ listening: number }>(
    db,
    "SELECT listening FROM reading WHERE user_id = ? AND book_id = ?",
    userId,
    bookId,
  );
  if (!reading) return notFound("Not currently reading");
  const r = await ensureRead(db, userId, bookId, { ...opts, listened: reading.listening === 1 });
  if (!r.ok) return r;
  await deleteReading(db, userId, bookId);
  return { ok: true };
}

export async function setListening(
  db: D1Database,
  userId: number,
  bookId: number,
  listening: boolean,
): Promise<Result> {
  const r = await execute(
    db,
    "UPDATE reading SET listening = ? WHERE user_id = ? AND book_id = ?",
    listening ? 1 : 0,
    userId,
    bookId,
  );
  return r.meta.changes ? { ok: true } : notFound("Not currently reading");
}

export async function backToWishlist(db: D1Database, userId: number, bookId: number): Promise<Result> {
  const state = await readingState(db, userId, bookId);
  if (!state) return notFound("Not currently reading");
  const r = await restoreToWishlist(db, userId, bookId, state);
  if (!r.ok) return r;
  await deleteReading(db, userId, bookId);
  return { ok: true };
}

// ---------- What a viewer already has, for marking a friend's books ----------

// rereading: on both the read list and currently reading.
export type MineStatus = "read" | "wish" | "reading" | "rereading" | null;

export async function viewerOwnership(db: D1Database, viewerId: number): Promise<(bookId: number) => MineStatus> {
  const rows = await queryAll<{ book_id: number; list: "read" | "wish" | "reading" }>(
    db,
    `SELECT book_id, 'reading' AS list FROM reading WHERE user_id = ?1
     UNION ALL SELECT book_id, 'read' FROM reads WHERE user_id = ?1
     UNION ALL SELECT book_id, 'wish' FROM wishlist WHERE user_id = ?1`,
    viewerId,
  );
  // Reading wins over read, which wins over wishlist; rows arrive in that order.
  const status = new Map<number, MineStatus>();
  for (const r of rows) {
    const known = status.get(r.book_id);
    if (!known) status.set(r.book_id, r.list);
    else if (known === "reading" && r.list === "read") status.set(r.book_id, "rereading");
  }
  return (bookId) => status.get(bookId) ?? null;
}

// Puts a book on one of the user's lists, moving it there from another. A book
// already read stays on the read list when it is read again.
export async function setStatus(
  db: D1Database,
  userId: number,
  ref: BookRef,
  status: "reading" | "wish" | "read",
): Promise<Result<{ book: BookRow; mine: MineStatus }>> {
  const r = await resolveBook(db, ref);
  if (!r.ok) return r;
  const bookId = r.book.id;
  const [read, wish, reading] = await Promise.all(
    (["reads", "wishlist", "reading"] as const).map((list) => onList(db, list, userId, bookId)),
  );

  let moved: Result = { ok: true };
  if (status === "reading") {
    if (!reading) moved = await addToReading(db, userId, { bookId });
  } else if (status === "wish") {
    if (read) moved = fail("You've already read this — it's on your books list");
    else if (reading) moved = await backToWishlist(db, userId, bookId);
    else if (!wish) moved = await insertWish(db, userId, bookId);
  } else if (reading) {
    moved = await finishReading(db, userId, bookId);
  } else if (wish) {
    moved = await moveToRead(db, userId, bookId);
  } else if (!read) {
    const { canAdd, limit } = await getBookAllowance(db, userId);
    moved = canAdd ? await insertRead(db, userId, bookId) : fail(`You have reached the maximum of ${limit} books`);
  }
  return moved.ok ? { ...r, mine: status === "reading" && read ? "rereading" : status } : moved;
}
