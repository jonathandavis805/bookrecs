import { db, now } from "./db";

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}

export function createSession(userId: number): string {
  const token = randomToken();
  db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(token, userId, now() + SESSION_TTL);
  return token;
}

export function getUserIdByToken(token: string): number | null {
  const row = db.query("SELECT user_id, expires_at FROM sessions WHERE token = ?")
    .get(token) as { user_id: number; expires_at: number } | undefined;
  
  if (!row) return null;
  
  if (row.expires_at < now()) {
    db.query("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return row.user_id;
}

export function deleteSession(token: string): void {
  db.query("DELETE FROM sessions WHERE token = ?").run(token);
}
