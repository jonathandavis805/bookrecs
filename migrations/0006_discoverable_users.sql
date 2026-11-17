-- Add privacy control for friend discovery

ALTER TABLE users ADD COLUMN discoverable INTEGER NOT NULL DEFAULT 1;
