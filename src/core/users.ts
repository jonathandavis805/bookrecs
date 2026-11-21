import { execute, now, queryAll, queryOne } from "../db";

export interface User {
  id: number;
  username: string;
  email: string;
  is_admin: number;
  status: "pending" | "approved" | "rejected";
  book_limit: number;
  rejected_at: number | null;
  discoverable: number;
  theme: string | null;
}

const USER_COLUMNS = "id, username, email, is_admin, status, book_limit, rejected_at, discoverable, theme";

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  return await queryOne<User>(db, `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, id);
}

// Display name for notifications about something a user did.
export async function usernameOf(db: D1Database, id: number): Promise<string> {
  return (await getUserById(db, id))?.username ?? "Someone";
}

export async function findUser(db: D1Database, identifier: string): Promise<(User & { password_hash: string }) | null> {
  return await queryOne<User & { password_hash: string }>(
    db,
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE username = ?1 COLLATE NOCASE OR email = ?1 COLLATE NOCASE`,
    identifier.trim(),
  );
}

export async function createUser(db: D1Database, username: string, email: string, passwordHash: string): Promise<User> {
  const row = await queryOne<User>(
    db,
    `INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?) RETURNING ${USER_COLUMNS}`,
    username,
    email,
    passwordHash,
  );
  if (!row) throw new Error("Could not create user");
  return row;
}

export async function setPassword(db: D1Database, userId: number, passwordHash: string): Promise<void> {
  await execute(db, "UPDATE users SET password_hash = ? WHERE id = ?", passwordHash, userId);
}

export async function setApiToken(db: D1Database, userId: number, token: string): Promise<void> {
  await execute(db, "UPDATE users SET api_token = ? WHERE id = ?", token, userId);
}

export async function getUserByApiToken(db: D1Database, token: string): Promise<User | null> {
  return await queryOne<User>(db, `SELECT ${USER_COLUMNS} FROM users WHERE api_token = ?`, token);
}

export async function usernameExists(db: D1Database, username: string): Promise<boolean> {
  return !!(await queryOne(db, "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", username));
}

export async function emailExists(db: D1Database, email: string): Promise<boolean> {
  return !!(await queryOne(db, "SELECT 1 FROM users WHERE email = ? COLLATE NOCASE", email));
}

// Discoverable users other than the viewer; a query filters by username or email.
export async function discoverUsers(
  db: D1Database,
  viewerId: number,
  query = "",
): Promise<{ id: number; username: string }[]> {
  const like = `%${query}%`;
  return await queryAll<{ id: number; username: string }>(
    db,
    `SELECT id, username FROM users
     WHERE id != ?1 AND discoverable = 1
       AND (?2 = '' OR username LIKE ?3 COLLATE NOCASE OR email LIKE ?3 COLLATE NOCASE)
     ORDER BY username LIMIT ?4`,
    viewerId,
    query,
    like,
    query ? 20 : 50,
  );
}

export async function setTheme(db: D1Database, userId: number, theme: string): Promise<void> {
  await execute(db, "UPDATE users SET theme = ? WHERE id = ?", theme, userId);
}

export async function setDiscoverable(db: D1Database, userId: number, discoverable: boolean): Promise<void> {
  await execute(db, "UPDATE users SET discoverable = ? WHERE id = ?", discoverable ? 1 : 0, userId);
}

export async function getAdminUsers(db: D1Database): Promise<{ id: number; username: string }[]> {
  return await queryAll<{ id: number; username: string }>(db, "SELECT id, username FROM users WHERE is_admin = 1");
}

export async function approveUser(db: D1Database, userId: number): Promise<void> {
  await execute(db, "UPDATE users SET status = 'approved', book_limit = 0 WHERE id = ?", userId);
}

export async function rejectUser(db: D1Database, userId: number): Promise<void> {
  await execute(db, "UPDATE users SET status = 'rejected', rejected_at = ? WHERE id = ?", now(), userId);
}

const REJECTION_GRACE_PERIOD_DAYS = 7;

export async function cleanupRejectedUsers(db: D1Database): Promise<{ deleted: number }> {
  const cutoff = now() - REJECTION_GRACE_PERIOD_DAYS * 86400;
  const result = await execute(
    db,
    "DELETE FROM users WHERE status = 'rejected' AND rejected_at IS NOT NULL AND rejected_at < ?",
    cutoff,
  );
  return { deleted: result.meta.changes ?? 0 };
}

// limit 0 means unlimited.
export async function getBookAllowance(
  db: D1Database,
  userId: number,
): Promise<{ count: number; limit: number; canAdd: boolean }> {
  const row = await queryOne<{ count: number; limit: number }>(
    db,
    'SELECT (SELECT COUNT(*) FROM reads WHERE user_id = ?1) AS count, book_limit AS "limit" FROM users WHERE id = ?1',
    userId,
  );
  const count = row?.count ?? 0;
  const limit = row?.limit ?? 25;
  return { count, limit, canAdd: limit === 0 || count < limit };
}
