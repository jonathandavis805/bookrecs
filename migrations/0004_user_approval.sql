-- Add user approval system

-- Add status column: 'pending' (default), 'approved', 'rejected'
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'));

-- Add book_limit column: default 25, can be changed to 0 for unlimited
ALTER TABLE users ADD COLUMN book_limit INTEGER NOT NULL DEFAULT 25;

-- Mark existing admin users as approved
UPDATE users SET status = 'approved', book_limit = 0 WHERE is_admin = 1;
