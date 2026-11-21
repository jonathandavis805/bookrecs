-- Whether a read book was listened to as an audiobook rather than read.
ALTER TABLE reads ADD COLUMN listened INTEGER NOT NULL DEFAULT 0;
