-- BookRecs D1 schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  api_token TEXT UNIQUE,
  share_wishlist INTEGER NOT NULL DEFAULT 0,
  "2fa_secret" TEXT,
  "2fa_enabled" INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_logins (
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
  manual INTEGER NOT NULL DEFAULT 0,
  synopsis TEXT
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

CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT NOT NULL,
  identifier TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (ip, identifier, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_reads_user ON reads(user_id, rank);
CREATE INDEX IF NOT EXISTS idx_friendships_req ON friendships(requestee_id, status);
CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup ON rate_limits(timestamp);
