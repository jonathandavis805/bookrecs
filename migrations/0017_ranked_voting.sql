-- Ranked ballots: each member ranks up to three nominations. A closed round's
-- nominations and votes are kept, tied to the pick they produced (pick_id is
-- NULL while the round is open). Runoffs keep the books they drop.
CREATE TABLE club_nominations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  vetoed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  eliminated INTEGER NOT NULL DEFAULT 0,
  pick_id INTEGER REFERENCES club_picks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE club_votes_new (
  nomination_id INTEGER NOT NULL REFERENCES club_nominations_new(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (nomination_id, user_id)
);

INSERT INTO club_nominations_new (id, club_id, user_id, book_id, vetoed_by, created_at)
SELECT id, club_id, user_id, book_id, vetoed_by, created_at FROM club_nominations;

INSERT INTO club_votes_new (nomination_id, user_id, rank, created_at)
SELECT nomination_id, user_id, 1, created_at FROM club_votes;

-- Votes first: dropping nominations would cascade into them.
DROP TABLE club_votes;
DROP TABLE club_nominations;
ALTER TABLE club_nominations_new RENAME TO club_nominations;
ALTER TABLE club_votes_new RENAME TO club_votes;

CREATE INDEX idx_club_nominations_club ON club_nominations(club_id, pick_id);
CREATE UNIQUE INDEX idx_club_nominations_open ON club_nominations(club_id, book_id) WHERE pick_id IS NULL;
CREATE INDEX idx_club_votes_user ON club_votes(user_id);
