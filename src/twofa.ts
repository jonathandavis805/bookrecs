import { execute, queryOne } from "./db";

const ISSUER = "BookRecs";

// ---- Minimal TOTP implementation using Web Crypto API (Workers-compatible) ----

// Base32 alphabet
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(data: Uint8Array): string {
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_CHARS[(value >> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of cleaned) {
    const idx = BASE32_CHARS.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return base32Encode(bytes);
}

async function hmacSHA1(secret: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, message);
  return new Uint8Array(sig);
}

async function generateTOTP(secret: Uint8Array, time?: number): Promise<string> {
  const period = 30;
  const digits = 6;
  const t = Math.floor((time ?? Date.now() / 1000) / period);

  // Counter as 8-byte big-endian
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, Math.floor(t / 0x100000000));
  view.setUint32(4, t & 0xffffffff);

  const hmac = await hmacSHA1(secret, buf);

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = code % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

export function generateTOTPUri(username: string, secret: string): string {
  const encodedIssuer = encodeURIComponent(ISSUER);
  const encodedName = encodeURIComponent(username);
  return `otpauth://totp/${encodedIssuer}:${encodedName}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

export async function verifyTOTP(_username: string, secret: string, token: string): Promise<boolean> {
  const secretBytes = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000);

  // Check current period and ±1 period (window of 1)
  for (let offset = -1; offset <= 1; offset++) {
    const time = now + offset * 30;
    const expected = await generateTOTP(secretBytes, time);
    if (expected === token) return true;
  }
  return false;
}

// ---- DB operations ----

export async function get2FAStatus(db: D1Database, userId: number): Promise<{ enabled: boolean }> {
  const user = await queryOne<any>(db, 'SELECT "2fa_enabled" FROM users WHERE id = ?', userId);
  return { enabled: user?.["2fa_enabled"] === 1 };
}

export async function enable2FA(db: D1Database, userId: number, secret: string): Promise<void> {
  await execute(db, 'UPDATE users SET "2fa_secret" = ?, "2fa_enabled" = 1 WHERE id = ?', secret, userId);
}

export async function disable2FA(db: D1Database, userId: number): Promise<void> {
  await execute(db, 'UPDATE users SET "2fa_secret" = NULL, "2fa_enabled" = 0 WHERE id = ?', userId);
}

export async function get2FASecret(db: D1Database, userId: number): Promise<string | null> {
  const user = await queryOne<any>(db, 'SELECT "2fa_secret" FROM users WHERE id = ?', userId);
  return user?.["2fa_secret"] || null;
}

export async function has2FAEnabled(db: D1Database, userId: number): Promise<boolean> {
  const user = await queryOne<any>(db, 'SELECT "2fa_enabled" FROM users WHERE id = ?', userId);
  return user?.["2fa_enabled"] === 1;
}
