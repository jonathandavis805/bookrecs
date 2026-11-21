#!/usr/bin/env node
/**
 * Migrate data from local SQLite to Cloudflare D1
 *
 * Usage: node scripts/migrate-to-d1.js
 *
 * This script:
 * - Reads data/bookrecs.sqlite
 * - Hashes temporary password "changeme123" using PBKDF2
 * - Generates SQL file and executes it on D1
 * - Sets all users to temporary password "changeme123"
 */

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEMP_PASSWORD = "changeme123";

// Hash password using PBKDF2 (same as Workers auth)
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const iterations = 100000;
  const keyLength = 32;

  const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, keyLength, "sha256");

  const saltB64 = salt.toString("base64");
  const hashB64 = derivedKey.toString("base64");

  return `${iterations}:${saltB64}:${hashB64}`;
}

// SQL-escape a string value
function sqlEscape(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return value.toString();
  // Escape single quotes by doubling them
  const escaped = String(value).replace(/'/g, "''");
  return `'${escaped}'`;
}

// Run wrangler command to execute SQL file on D1
function executeD1File(sqlFilePath) {
  const cmd = `npx wrangler d1 execute bookrecs-db --remote --file=${sqlFilePath}`;

  try {
    const result = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    });
    return result;
  } catch (err) {
    console.error("D1 command failed:", err.message);
    if (err.stderr) console.error("stderr:", err.stderr);
    throw err;
  }
}

// Read SQLite database
function readSQLite(query) {
  const dbPath = join(process.cwd(), "data/bookrecs.sqlite");
  const cmd = `sqlite3 -json ${dbPath} "${query.replace(/"/g, '\\"')}"`;

  try {
    const result = execSync(cmd, { encoding: "utf-8" });
    return result ? JSON.parse(result) : [];
  } catch (err) {
    console.error("SQLite query failed:", err.message);
    return [];
  }
}

async function migrate() {
  console.log("🚀 Starting migration from SQLite to D1...\n");

  // Hash the temporary password
  console.log(`🔐 Hashing temporary password: "${TEMP_PASSWORD}"`);
  const tempHash = hashPassword(TEMP_PASSWORD);
  console.log("✅ Password hashed\n");

  // Read data from SQLite
  console.log("📖 Reading SQLite database...");
  const users = readSQLite("SELECT * FROM users");
  const books = readSQLite("SELECT * FROM books");
  const reads = readSQLite("SELECT * FROM reads");
  const wishlist = readSQLite("SELECT * FROM wishlist");
  const reading = readSQLite("SELECT * FROM reading");
  const friendships = readSQLite("SELECT * FROM friendships");

  console.log(
    `✅ Found ${users.length} users, ${books.length} books, ${reads.length} reads, ${wishlist.length} wishlist items, ${reading.length} reading items, ${friendships.length} friendships\n`,
  );

  // Generate SQL file
  const sqlStatements = [];

  // Clear existing data (in case of re-run)
  sqlStatements.push("DELETE FROM sessions;");
  sqlStatements.push("DELETE FROM rate_limits;");
  sqlStatements.push("DELETE FROM pending_logins;");
  sqlStatements.push("DELETE FROM friendships;");
  sqlStatements.push("DELETE FROM reading;");
  sqlStatements.push("DELETE FROM wishlist;");
  sqlStatements.push("DELETE FROM reads;");
  sqlStatements.push("DELETE FROM books;");
  sqlStatements.push("DELETE FROM users;");
  sqlStatements.push("");

  // Migrate users
  console.log("👤 Preparing users...");
  for (const user of users) {
    console.log(`  - ${user.username} (${user.email})`);
    sqlStatements.push(
      `INSERT INTO users (id, username, email, password_hash, api_token, created_at) VALUES (${user.id}, ${sqlEscape(user.username)}, ${sqlEscape(user.email)}, ${sqlEscape(tempHash)}, ${user.api_token === null ? "NULL" : sqlEscape(user.api_token)}, ${user.created_at});`,
    );
  }
  console.log("✅ Users prepared\n");

  // Migrate books
  console.log("📚 Preparing books...");
  for (const book of books) {
    sqlStatements.push(
      `INSERT INTO books (id, ol_key, title, author, cover_url, first_publish_year, synopsis, manual) VALUES (${book.id}, ${sqlEscape(book.ol_key)}, ${sqlEscape(book.title)}, ${sqlEscape(book.author)}, ${sqlEscape(book.cover_url)}, ${book.first_publish_year === null ? "NULL" : book.first_publish_year}, ${sqlEscape(book.synopsis)}, ${book.manual});`,
    );
  }
  console.log(`✅ ${books.length} books prepared\n`);

  // Migrate reads
  console.log("📖 Preparing reads...");
  for (const read of reads) {
    sqlStatements.push(
      `INSERT INTO reads (user_id, book_id, rank, review, public, created_at, updated_at) VALUES (${read.user_id}, ${read.book_id}, ${read.rank}, ${sqlEscape(read.review)}, ${read.public}, ${read.created_at}, ${read.updated_at});`,
    );
  }
  console.log(`✅ ${reads.length} reads prepared\n`);

  // Migrate wishlist
  console.log("💝 Preparing wishlist...");
  for (const wish of wishlist) {
    sqlStatements.push(
      `INSERT INTO wishlist (user_id, book_id, owned, public, rank, created_at) VALUES (${wish.user_id}, ${wish.book_id}, ${wish.owned}, ${wish.public}, ${wish.rank}, ${wish.created_at});`,
    );
  }
  console.log(`✅ ${wishlist.length} wishlist items prepared\n`);

  // Migrate reading
  console.log("📖 Preparing currently reading...");
  for (const item of reading) {
    sqlStatements.push(
      `INSERT INTO reading (user_id, book_id, wishlist_rank, wishlist_owned, wishlist_public, created_at) VALUES (${item.user_id}, ${item.book_id}, ${item.wishlist_rank === null ? "NULL" : item.wishlist_rank}, ${item.wishlist_owned === null ? "NULL" : item.wishlist_owned}, ${item.wishlist_public === null ? "NULL" : item.wishlist_public}, ${item.created_at});`,
    );
  }
  console.log(`✅ ${reading.length} reading items prepared\n`);

  // Migrate friendships
  console.log("🤝 Preparing friendships...");
  for (const friendship of friendships) {
    sqlStatements.push(
      `INSERT INTO friendships (id, requester_id, requestee_id, status, created_at) VALUES (${friendship.id}, ${friendship.requester_id}, ${friendship.requestee_id}, ${sqlEscape(friendship.status)}, ${friendship.created_at});`,
    );
  }
  console.log(`✅ ${friendships.length} friendships prepared\n`);

  // Write SQL file
  const sqlFilePath = join(process.cwd(), "migrations/0002_migrate_data.sql");
  writeFileSync(sqlFilePath, sqlStatements.join("\n"));
  console.log(`📝 SQL file written to ${sqlFilePath}\n`);

  // Execute SQL file on D1
  console.log("🚀 Executing migration on D1...");
  try {
    executeD1File(sqlFilePath);
    console.log("✅ Migration executed\n");
  } catch (err) {
    console.error("❌ Migration failed");
    throw err;
  }

  // Clean up SQL file
  unlinkSync(sqlFilePath);

  console.log("🎉 Migration complete!");
  console.log(`\n⚠️  IMPORTANT: All users now have the temporary password: "${TEMP_PASSWORD}"`);
  console.log("They should log in and change their password immediately.\n");
  console.log("You can now access your data at https://bookrecs.dev");
}

migrate().catch((err) => {
  console.error("\n❌ Migration failed:", err.message);
  process.exit(1);
});
