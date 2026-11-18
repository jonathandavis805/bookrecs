-- Book clubs: a group of friends nominates and votes on books to read together.

CREATE TABLE IF NOT EXISTS clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voting_open INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS club_members (
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE IF NOT EXISTS club_nominations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (club_id, book_id)
);

CREATE TABLE IF NOT EXISTS club_votes (
  nomination_id INTEGER NOT NULL REFERENCES club_nominations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (nomination_id, user_id)
);

CREATE TABLE IF NOT EXISTS club_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  picked_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_club_members_user ON club_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_club_nominations_club ON club_nominations(club_id);
CREATE INDEX IF NOT EXISTS idx_club_votes_user ON club_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_club_picks_club ON club_picks(club_id, picked_at DESC);
