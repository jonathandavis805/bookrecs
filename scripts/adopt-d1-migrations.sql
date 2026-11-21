-- Production used to track applied migrations in schema_migrations (written by
-- a custom runner); wrangler tracks them in d1_migrations. Copy that history
-- across so `wrangler d1 migrations apply` skips what's already applied.
-- Idempotent, and a no-op on databases that never had the old table.
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT OR IGNORE INTO d1_migrations (name) SELECT filename FROM schema_migrations ORDER BY filename;
