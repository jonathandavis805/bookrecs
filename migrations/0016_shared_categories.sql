-- Categories now apply to a book on any of the user's lists, so a tag no longer
-- belongs to its reads row and survives moves between lists.
CREATE TABLE category_books_new (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, book_id)
);

INSERT INTO category_books_new (category_id, user_id, book_id)
SELECT category_id, user_id, book_id FROM category_books;

DROP TABLE category_books;
ALTER TABLE category_books_new RENAME TO category_books;

CREATE INDEX idx_category_books_user_book ON category_books(user_id, book_id);
