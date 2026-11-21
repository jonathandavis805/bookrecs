import { execute, now, queryOne } from "./db";

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// PBKDF2 password hashing using Web Crypto API (Workers-compatible)
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, [
    "deriveBits",
  ]);

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH * 8,
  );

  // Format: iterations:salt:hash (all base64)
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return `${PBKDF2_ITERATIONS}:${saltB64}:${hashB64}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split(":");
  if (parts.length !== 3) return false;

  const [iterationsStr, saltB64, hashB64] = parts;
  const iterations = parseInt(iterationsStr, 10);
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const expectedHash = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, [
    "deriveBits",
  ]);

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH * 8,
  );

  const actualHash = new Uint8Array(bits);

  // Constant-time comparison
  if (actualHash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHash.length; i++) {
    diff |= actualHash[i] ^ expectedHash[i];
  }
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
    await execute(db, "DELETE FROM sessions WHERE token = ?", token);
    return null;
  }
  return row.user_id;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await execute(db, "DELETE FROM sessions WHERE token = ?", token);
}
