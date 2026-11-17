-- Add rejected_at timestamp for grace period tracking

ALTER TABLE users ADD COLUMN rejected_at INTEGER;
