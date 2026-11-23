import { execute, queryAll, queryOne } from "../db";
import { fetchSynopsis, fetchWork } from "../ol";
import { FRIEND_IDS } from "./friends";
import { fail, notFound, type Result } from "./result";

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

// Columns of the books table, aliased b, as selected alongside list rows.
export const BOOK_COLUMNS =
  "b.id, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual, b.synopsis";

interface ManualBookFields {
  title?: unknown;
  author?: unknown;
  year?: unknown;
  coverUrl?: unknown;
}

// How a request names a book: an existing book, an Open Library work, or a manual entry.
export interface BookRef {
  bookId?: number;
  olKey?: string;
  year?: number;
  manual?: ManualBookFields;
}

async function getBookById(db: D1Database, id: number): Promise<BookRow | null> {
  return await queryOne<BookRow>(db, "SELECT * FROM books WHERE id = ?", id);
}

// Book ids by Open Library key, for the keys that are already in the system.
export async function getExistingBookKeys(db: D1Database, keys: string[]): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  const rows = await queryAll<{ id: number; ol_key: string }>(
    db,
    `SELECT id, ol_key FROM books WHERE ol_key IN (${keys.map(() => "?").join(",")})`,
    ...keys,
  );
  return new Map(rows.map((r) => [r.ol_key, r.id]));
}

async function getOrCreateByOlKey(db: D1Database, olKey: string, yearHint?: number): Promise<BookRow | null> {
  const existing = await queryOne<BookRow>(db, "SELECT * FROM books WHERE ol_key = ?", olKey);
  if (existing) {
    if (existing.first_publish_year || !yearHint) return existing;
    return await queryOne<BookRow>(
      db,
      "UPDATE books SET first_publish_year = ? WHERE id = ? RETURNING *",
      yearHint,
      existing.id,
    );
  }
  const w = await fetchWork(olKey);
  if (!w) return null;
  return await queryOne<BookRow>(
    db,
    "INSERT INTO books (ol_key, title, author, cover_url, first_publish_year, synopsis) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
    w.key,
    w.title,
    w.author || null,
    w.coverUrl || null,
    yearHint ?? w.year ?? null,
    w.synopsis ?? null,
  );
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

async function createManualBook(db: D1Database, fields: ManualBookFields): Promise<Result<{ book: BookRow }>> {
  const title = text(fields.title);
  if (!title) return fail("Title is required");
  const year = fields.year === "" || fields.year == null ? null : Number(fields.year);
  const book = await queryOne<BookRow>(
    db,
    "INSERT INTO books (ol_key, title, author, cover_url, first_publish_year, manual) VALUES (?, ?, ?, ?, ?, 1) RETURNING *",
    `manual:${crypto.randomUUID()}`,
    title,
    text(fields.author),
    text(fields.coverUrl),
    year != null && Number.isFinite(year) ? Math.round(year) : null,
  );
  return book ? { ok: true, book } : fail("Could not create book");
}

export async function resolveBook(db: D1Database, ref: BookRef): Promise<Result<{ book: BookRow }>> {
  if (ref.manual) return await createManualBook(db, ref.manual);
  if (ref.bookId != null) {
    const book = await getBookById(db, ref.bookId);
    return book ? { ok: true, book } : notFound("Book not found");
  }
  if (!ref.olKey) return fail("ol_key or book_id is required");
  const book = await getOrCreateByOlKey(db, ref.olKey, ref.year);
  return book ? { ok: true, book } : fail("Could not load book from Open Library");
}

export interface MyBookHit {
  bookId: number;
  key: string;
  title: string;
  author: string;
  coverUrl?: string;
  year?: number;
  list: "reading" | "wish" | "read";
}

// Books from the user's own lists (reading, wishlist, read) whose title or
// author matches the query. Club nomination search uses this so members can
// nominate straight from their shelves. A book on several lists appears once,
// preferring reading over wishlist over read.
export async function searchMyBooks(db: D1Database, userId: number, q: string): Promise<MyBookHit[]> {
  const rows = await queryAll<BookRow & { list: MyBookHit["list"] }>(
    db,
    `SELECT ${BOOK_COLUMNS}, x.list
     FROM books b
     JOIN (
       SELECT book_id, 'reading' AS list, 0 AS ord FROM reading WHERE user_id = ?1
       UNION ALL
       SELECT book_id, 'wish' AS list, 1 AS ord FROM wishlist WHERE user_id = ?1
       UNION ALL
       SELECT book_id, 'read' AS list, 2 AS ord FROM reads WHERE user_id = ?1
     ) x ON x.book_id = b.id
     WHERE b.title LIKE ?2 OR b.author LIKE ?2
     ORDER BY x.ord ASC`,
    userId,
    `%${q}%`,
  );
  const seen = new Set<number>();
  return rows
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .map((r) => ({
      bookId: r.id,
      key: r.ol_key,
      title: r.title,
      author: r.author ?? "",
      coverUrl: r.cover_url ?? undefined,
      year: r.first_publish_year ?? undefined,
      list: r.list,
    }));
}

export async function setBookCover(db: D1Database, id: number, coverUrl: string): Promise<BookRow | null> {
  return await queryOne<BookRow>(db, "UPDATE books SET cover_url = ? WHERE id = ? RETURNING *", coverUrl, id);
}

interface FriendActivity {
  username: string;
  review: string | null;
  rank: number | null;
  owned: number;
  status: "read" | "wishlist" | "reading";
}

// The viewer's own entries for the book, one per list it's on.
interface MyActivity {
  read: { rank: number; review: string | null; listened: number; public: number } | null;
  wishlist: { rank: number; owned: number; public: number } | null;
  reading: { listening: number } | null;
}

export interface BookDetail extends BookRow {
  friends: FriendActivity[];
  mine: MyActivity;
}

export async function getBookDetail(db: D1Database, viewerId: number, bookId: number): Promise<BookDetail | null> {
  const book = await getBookById(db, bookId);
  if (!book) return null;
  const friends = await queryAll<FriendActivity>(
    db,
    `SELECT u.username, x.review, x.rank, x.owned, x.status
     FROM (
       SELECT user_id, review, rank, 0 AS owned, 'read' AS status, 0 AS ord FROM reads WHERE book_id = ?2 AND public = 1
       UNION ALL
       SELECT user_id, NULL, NULL, owned, 'wishlist', 1 FROM wishlist WHERE book_id = ?2 AND public = 1
       UNION ALL
       SELECT user_id, NULL, NULL, 0, 'reading', 2 FROM reading WHERE book_id = ?2
     ) x
     JOIN users u ON u.id = x.user_id
     WHERE x.user_id IN (${FRIEND_IDS})
     ORDER BY u.username COLLATE NOCASE, x.ord`,
    viewerId,
    bookId,
  );
  const [read, wishlist, reading] = await Promise.all([
    queryOne<NonNullable<MyActivity["read"]>>(
      db,
      "SELECT rank, review, listened, public FROM reads WHERE user_id = ? AND book_id = ?",
      viewerId,
      bookId,
    ),
    queryOne<NonNullable<MyActivity["wishlist"]>>(
      db,
      "SELECT rank, owned, public FROM wishlist WHERE user_id = ? AND book_id = ?",
      viewerId,
      bookId,
    ),
    queryOne<NonNullable<MyActivity["reading"]>>(
      db,
      "SELECT listening FROM reading WHERE user_id = ? AND book_id = ?",
      viewerId,
      bookId,
    ),
  ]);
  return { ...book, friends, mine: { read, wishlist, reading } };
}

export async function backfillSynopses(db: D1Database): Promise<{ updated: number; failed: number }> {
  const books = await queryAll<{ id: number; ol_key: string }>(
    db,
    "SELECT id, ol_key FROM books WHERE synopsis IS NULL AND manual = 0",
  );
  let updated = 0;
  let failed = 0;
  for (const book of books) {
    try {
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
