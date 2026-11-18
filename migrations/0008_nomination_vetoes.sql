-- One veto per member per vote cycle: a vetoed nomination is struck from the
-- vote (its votes are released, it can't win). Vetoes reset when the vote
-- closes because the cycle's nominations are deleted.

ALTER TABLE club_nominations ADD COLUMN vetoed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
