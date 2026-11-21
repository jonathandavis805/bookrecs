-- Whether a currently-reading book is being listened to as an audiobook.
ALTER TABLE reading ADD COLUMN listening INTEGER NOT NULL DEFAULT 0;
