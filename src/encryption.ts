// Session token encryption using AES-256-GCM
// Key should be stored in BOOKRECS_ENCRYPTION_KEY env var (32 bytes / 64 hex chars)

const ALGORITHM = "AES-256-GCM";
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 16; // 128 bits

// Get or generate encryption key
function getEncryptionKey(): Buffer {
  const envKey = process.env.BOOKRECS_ENCRYPTION_KEY;
  
  if (!envKey) {
    throw new Error(
      "BOOKRECS_ENCRYPTION_KEY environment variable is required.\n" +
      "Generate one with: openssl rand -hex 32"
    );
  }
  
  if (envKey.length !== 64) {
    throw new Error("BOOKRECS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  
  return Buffer.from(envKey, "hex");
}

// Encrypt a string
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const keyCryptoKey = crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  
  // This is synchronous in Bun but we need to use Web Crypto API
  // For now, let's use a simpler approach with Node.js crypto
  return encryptSync(plaintext, key, Buffer.from(iv));
}

// Decrypt a string
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  return decryptSync(ciphertext, key);
}

// Synchronous encryption using Node.js crypto (available in Bun)
function encryptSync(plaintext: string, key: Buffer, iv: Buffer): string {
  const crypto = require("crypto");
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

// Synchronous decryption
function decryptSync(ciphertext: string, key: Buffer): string {
  const crypto = require("crypto");
  const parts = ciphertext.split(":");
  
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format");
  }
  
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

// Generate a new encryption key
export function generateKey(): string {
  const crypto = require("crypto");
  return crypto.randomBytes(32).toString("hex");
}
