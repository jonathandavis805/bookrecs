import { execute, queryAll, queryOne } from "../db";
import { rankedIds, requestedOrder, writeRanks } from "./lists";
import { fail, notFound, type Result } from "./result";

export interface Category {
  id: number;
  name: string;
}

const MAX_NAME = 50;

// With publicOnly, only categories holding at least one book a friend can see.
export async function listCategories(db: D1Database, userId: number, publicOnly = false): Promise<Category[]> {
  const visible = publicOnly
    ? `AND EXISTS (SELECT 1 FROM category_books cb JOIN (
                     SELECT user_id, book_id FROM reads WHERE public = 1
                     UNION ALL SELECT user_id, book_id FROM wishlist WHERE public = 1
                     UNION ALL SELECT user_id, book_id FROM reading
                   ) v ON v.user_id = cb.user_id AND v.book_id = cb.book_id
                   WHERE cb.category_id = c.id)`
    : "";
  return await queryAll<Category>(
    db,
    `SELECT c.id, c.name FROM categories c WHERE c.user_id = ? ${visible} ORDER BY c.name COLLATE NOCASE`,
    userId,
  );
}

async function checkName(
  db: D1Database,
  userId: number,
  raw: unknown,
  exceptId = 0,
): Promise<Result<{ name: string }>> {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return fail("Category name is required");
  if (name.length > MAX_NAME) return fail(`Category names are limited to ${MAX_NAME} characters`);
  const taken = await queryOne<{ name: string }>(
    db,
    "SELECT name FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?",
    userId,
    name,
    exceptId,
  );
  return taken ? fail(`You already have a category called "${taken.name}"`) : { ok: true, name };
}

export async function createCategory(
  db: D1Database,
  userId: number,
  raw: unknown,
): Promise<Result<{ category: Category }>> {
  const r = await checkName(db, userId, raw);
  if (!r.ok) return r;
  const res = await execute(db, "INSERT INTO categories (user_id, name) VALUES (?, ?)", userId, r.name);
  return { ok: true, category: { id: res.meta.last_row_id, name: r.name } };
}

export async function renameCategory(db: D1Database, userId: number, id: number, raw: unknown): Promise<Result> {
  const r = await checkName(db, userId, raw, id);
  if (!r.ok) return r;
  const res = await execute(db, "UPDATE categories SET name = ? WHERE id = ? AND user_id = ?", r.name, id, userId);
  return res.meta.changes ? { ok: true } : notFound("Category not found");
}

export async function deleteCategory(db: D1Database, userId: number, id: number): Promise<Result> {
  const res = await execute(db, "DELETE FROM categories WHERE id = ? AND user_id = ?", id, userId);
  return res.meta.changes ? { ok: true } : notFound("Category not found");
}

// Replaces the book's categories. Ids that aren't the user's are ignored.
export async function setBookCategories(
  db: D1Database,
  userId: number,
  bookId: number,
  categoryIds: number[],
): Promise<Result> {
  const onAny = await queryOne(
    db,
    `SELECT 1 FROM reads WHERE user_id = ?1 AND book_id = ?2
     UNION ALL SELECT 1 FROM wishlist WHERE user_id = ?1 AND book_id = ?2
     UNION ALL SELECT 1 FROM reading WHERE user_id = ?1 AND book_id = ?2`,
    userId,
    bookId,
  );
  if (!onAny) return notFound("Book not on your lists");
  const own = new Set((await listCategories(db, userId)).map((c) => c.id));
  const ids = [...new Set(categoryIds)].filter((id) => own.has(id));
  await db.batch([
    db.prepare("DELETE FROM category_books WHERE user_id = ? AND book_id = ?").bind(userId, bookId),
    ...ids.map((id) =>
      db
        .prepare("INSERT INTO category_books (category_id, user_id, book_id) VALUES (?, ?, ?)")
        .bind(id, userId, bookId),
    ),
  ]);
  return { ok: true };
}

// A category has no rank of its own, so reordering it permutes its books among
// the global slots they already hold; books outside the category don't move.
export async function reorderCategory(
  db: D1Database,
  userId: number,
  categoryId: number,
  requested: number[],
): Promise<Result> {
  if (!(await queryOne(db, "SELECT 1 FROM categories WHERE id = ? AND user_id = ?", categoryId, userId))) {
    return notFound("Category not found");
  }
  const rows = await queryAll<{ book_id: number }>(
    db,
    "SELECT book_id FROM category_books WHERE category_id = ?",
    categoryId,
  );
  const members = new Set(rows.map((r) => r.book_id));
  const global = await rankedIds(db, "reads", userId);
  const order = requestedOrder(
    global.filter((id) => members.has(id)),
    requested,
  );
  let next = 0;
  await writeRanks(
    db,
    "reads",
    userId,
    global.map((id) => (members.has(id) ? order[next++] : id)),
  );
  return { ok: true };
}
