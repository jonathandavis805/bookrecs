import { TOTP, Secret } from "otpauth";
import { db } from "./db";

const ISSUER = "BookRecs";

// Generate a new TOTP secret
export function generateSecret(): string {
  const secret = new Secret({ size: 20 });
  return secret.base32;
}

// Create a TOTP instance for a user
function createTOTP(username: string, secret: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}

// Generate TOTP URI for QR code
export function generateTOTPUri(username: string, secret: string): string {
  const totp = createTOTP(username, secret);
  return totp.toString();
}

// Verify a TOTP token
export function verifyTOTP(username: string, secret: string, token: string): boolean {
  const totp = createTOTP(username, secret);
  const delta = totp.validate({ token, window: 1 }); // Allow 1 period drift
  return delta !== null;
}

// Get user's 2FA status
export function get2FAStatus(userId: number): { enabled: boolean } {
  const user = db.query('SELECT "2fa_enabled" FROM users WHERE id = ?').get(userId) as any;
  return { enabled: user?.["2fa_enabled"] === 1 };
}

// Enable 2FA for a user
export function enable2FA(userId: number, secret: string): void {
  db.query('UPDATE users SET "2fa_secret" = ?, "2fa_enabled" = 1 WHERE id = ?')
    .run(secret, userId);
}

// Disable 2FA for a user
export function disable2FA(userId: number): void {
  db.query('UPDATE users SET "2fa_secret" = NULL, "2fa_enabled" = 0 WHERE id = ?')
    .run(userId);
}

// Get user's 2FA secret (for verification)
export function get2FASecret(userId: number): string | null {
  const user = db.query('SELECT "2fa_secret" FROM users WHERE id = ?').get(userId) as any;
  return user?.["2fa_secret"] || null;
}

// Check if user has 2FA enabled
export function has2FAEnabled(userId: number): boolean {
  const user = db.query('SELECT "2fa_enabled" FROM users WHERE id = ?').get(userId) as any;
  return user?.["2fa_enabled"] === 1;
}
