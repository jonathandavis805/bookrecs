-- One stage column replaces voting_open / nominations_open / runoff, which
-- encoded four states in three flags. A runoff is a second round of voting.
ALTER TABLE clubs ADD COLUMN stage TEXT NOT NULL DEFAULT 'nominating'
  CHECK (stage IN ('nominating', 'voting', 'runoff', 'closed'));

UPDATE clubs SET stage = CASE
  WHEN voting_open = 1 AND runoff = 1 THEN 'runoff'
  WHEN voting_open = 1 THEN 'voting'
  WHEN nominations_open = 1 THEN 'nominating'
  ELSE 'closed'
END;

ALTER TABLE clubs DROP COLUMN voting_open;
ALTER TABLE clubs DROP COLUMN nominations_open;
ALTER TABLE clubs DROP COLUMN runoff;
