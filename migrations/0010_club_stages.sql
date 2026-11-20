-- Club stages: a nomination stage first, then the owner opens voting.
-- Existing clubs keep their state: voting_open=1 means the voting stage
-- (nominations closed), voting_open=0 means closed between picks.
ALTER TABLE clubs ADD COLUMN nominations_open INTEGER NOT NULL DEFAULT 0;