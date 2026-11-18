-- Runoff voting: when the top vote is tied, the owner starts a runoff
-- instead of the old "earliest nomination wins" rule. Non-tied nominations
-- are dropped, votes are reset, and members re-vote among the tied books.

ALTER TABLE clubs ADD COLUMN runoff INTEGER NOT NULL DEFAULT 0;
