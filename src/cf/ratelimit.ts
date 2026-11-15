import { queryOne, queryAll, execute, now } from "./db";

const RATE_LIMIT_WINDOW = 15 * 60; // 15 minutes in seconds
const MAX_ATTEMPTS = 5;

async function cleanup(db: D1Database): Promise<void> {
  const cutoff = now() - RATE_LIMIT_WINDOW;
  await execute(db, "DELETE FROM rate_limits WHERE timestamp < ?", cutoff);
}

export async function isBlocked(db: D1Database, ip: string, identifier: string): Promise<boolean> {
  await cleanup(db);
  const cutoff = now() - RATE_LIMIT_WINDOW;
  const rows = await queryAll<{ cnt: number }>(
    db,
    "SELECT COUNT(*) as cnt FROM rate_limits WHERE ip = ? AND identifier = ? AND timestamp >= ?",
    ip, identifier, cutoff
  );
  return (rows[0]?.cnt ?? 0) >= MAX_ATTEMPTS;
}

export async function recordFailedAttempt(db: D1Database, ip: string, identifier: string): Promise<void> {
  await execute(db, "INSERT INTO rate_limits (ip, identifier, timestamp) VALUES (?, ?, ?)", ip, identifier, now());
}

export async function clearAttempts(db: D1Database, ip: string, identifier: string): Promise<void> {
  await execute(db, "DELETE FROM rate_limits WHERE ip = ? AND identifier = ?", ip, identifier);
}
