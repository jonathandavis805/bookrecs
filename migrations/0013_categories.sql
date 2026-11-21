-- User-defined categories of read books. A category has no rank of its own:
-- its order is the global reads order restricted to its members.
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, name COLLATE NOCASE)
);

CREATE TABLE category_books (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  PRIMARY KEY (category_id, book_id),
  FOREIGN KEY (user_id, book_id) REFERENCES reads(user_id, book_id) ON DELETE CASCADE
);

CREATE INDEX idx_category_books_read ON category_books(user_id, book_id);
