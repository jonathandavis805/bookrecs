import { execute, now, queryOne } from "./db";

export const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// PBKDF2 password hashing using Web Crypto API (Workers-compatible).
// Stored as iterations:salt:hash, both base64.
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_ITERATIONS}:${toBase64(salt)}:${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [iterations, salt, expected] = stored.split(":");
  if (!expected) return false;
  const actual = await derive(password, fromBase64(salt), Number.parseInt(iterations, 10));
  const want = fromBase64(expected);
  if (actual.length !== want.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ want[i];
  return diff === 0;
}

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = randomToken();
  await execute(
    db,
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    token,
    userId,
    now() + SESSION_TTL,
  );
  return token;
}

export async function getUserIdByToken(db: D1Database, token: string): Promise<number | null> {
  const row = await queryOne<{ user_id: number; expires_at: number }>(
    db,
    "SELECT user_id, expires_at FROM sessions WHERE token = ?",
    token,
  );
  if (!row) return null;
  if (row.expires_at < now()) {
    await deleteSession(db, token);
    return null;
  }
  return row.user_id;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await execute(db, "DELETE FROM sessions WHERE token = ?", token);
}
