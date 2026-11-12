import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.BOOKRECS_DB
  ? resolve(process.env.BOOKRECS_DB)
  : resolve(REPO_ROOT, "data/bookrecs.sqlite");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    api_token TEXT UNIQUE,
    share_wishlist INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ol_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    author TEXT,
    cover_url TEXT,
    first_publish_year INTEGER,
    manual INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS reads (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    review TEXT,
    public INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, book_id)
  );

  CREATE TABLE IF NOT EXISTS wishlist (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    owned INTEGER NOT NULL DEFAULT 0,
    public INTEGER NOT NULL DEFAULT 0,
    rank INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, book_id)
  );

  CREATE TABLE IF NOT EXISTS reading (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    wishlist_rank INTEGER,
    wishlist_owned INTEGER,
    wishlist_public INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, book_id)
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requestee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending','accepted')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (requester_id, requestee_id)
  );

  CREATE INDEX IF NOT EXISTS idx_reads_user ON reads(user_id, rank);
  CREATE INDEX IF NOT EXISTS idx_friendships_req ON friendships(requestee_id, status);
`);

// Idempotent migrations for columns added after the initial release.
const bookCols = (db.query("PRAGMA table_info(books)").all() as { name: string }[]).map((c) => c.name);
if (!bookCols.includes("manual")) {
  db.exec("ALTER TABLE books ADD COLUMN manual INTEGER NOT NULL DEFAULT 0");
}
const userCols = (db.query("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
if (!userCols.includes("share_wishlist")) {
  db.exec("ALTER TABLE users ADD COLUMN share_wishlist INTEGER NOT NULL DEFAULT 0");
}
const wishCols = (db.query("PRAGMA table_info(wishlist)").all() as { name: string }[]).map((c) => c.name);
if (!wishCols.includes("owned")) {
  db.exec("ALTER TABLE wishlist ADD COLUMN owned INTEGER NOT NULL DEFAULT 0");
}

// Per-book privacy: existing rows become public; new rows default to private.
const readsCols = (db.query("PRAGMA table_info(reads)").all() as { name: string }[]).map((c) => c.name);
if (!readsCols.includes("public")) {
  db.exec("ALTER TABLE reads ADD COLUMN public INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE reads SET public = 1");
}
const wishPubCols = (db.query("PRAGMA table_info(wishlist)").all() as { name: string }[]).map((c) => c.name);
if (!wishPubCols.includes("public")) {
  db.exec("ALTER TABLE wishlist ADD COLUMN public INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE wishlist SET public = 1");
}
const wishRankCols = (db.query("PRAGMA table_info(wishlist)").all() as { name: string }[]).map((c) => c.name);
if (!wishRankCols.includes("rank")) {
  db.exec("ALTER TABLE wishlist ADD COLUMN rank INTEGER NOT NULL DEFAULT 0");
  // Backfill 1..n ranks per user, preserving current display order (newest first).
  const rows = (db.query("SELECT user_id, book_id FROM wishlist ORDER BY user_id, created_at DESC, book_id DESC")
    .all() as { user_id: number; book_id: number }[]);
  const upd = db.query("UPDATE wishlist SET rank = ? WHERE user_id = ? AND book_id = ?");
  let lastUserId: number | null = null;
  let n = 0;
  for (const r of rows) {
    n = r.user_id === lastUserId ? n + 1 : 1;
    lastUserId = r.user_id;
    upd.run(n, r.user_id, r.book_id);
  }
}

const readingCols = (db.query("PRAGMA table_info(reading)").all() as { name: string }[]).map((c) => c.name);
if (!readingCols.includes("wishlist_rank")) {
  db.exec("ALTER TABLE reading ADD COLUMN wishlist_rank INTEGER");
  db.exec("ALTER TABLE reading ADD COLUMN wishlist_owned INTEGER");
  db.exec("ALTER TABLE reading ADD COLUMN wishlist_public INTEGER");
}

// Cache OpenLibrary subjects for discover candidates
const bookCols2 = (db.query("PRAGMA table_info(books)").all() as { name: string }[]).map((c) => c.name);
if (!bookCols2.includes("subjects")) {
  db.exec("ALTER TABLE books ADD COLUMN subjects TEXT");
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}
