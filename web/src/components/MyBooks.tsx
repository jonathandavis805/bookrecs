import { useEffect, useRef, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { api, Book, WishlistItem, ReadingItem } from "../api";

export default function MyBooks() {
  const [books, setBooks] = useState<Book[]>([]);
  const [wish, setWish] = useState<WishlistItem[]>([]);
  const [reading, setReading] = useState<ReadingItem[]>([]);
  const [reviews, setReviews] = useState<Record<number, string>>({});
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [r, w, g] = await Promise.all([
        api<{ books: Book[] }>("/api/me/books"),
        api<{ books: WishlistItem[] }>("/api/me/wishlist"),
        api<{ books: ReadingItem[] }>("/api/me/reading"),
      ]);
      setBooks(r.books);
      setWish(w.books);
      setReading(g.books);
      const rv: Record<number, string> = {};
      r.books.forEach((b) => {
        if (b.review != null) rv[b.book_id] = b.review;
      });
      setReviews(rv);
      setDirty({});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => {
      if (readTimer.current) clearTimeout(readTimer.current);
      if (wishTimer.current) clearTimeout(wishTimer.current);
    };
  }, []);

  function handleReadReorder(newOrder: Book[]) {
    setBooks(newOrder);
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      api("/api/me/books/reorder", {
        method: "POST",
        body: JSON.stringify({ ordered: newOrder.map((b) => b.book_id) }),
      }).catch((e: any) => setError(e.message));
    }, 300);
  }

  function handleWishReorder(newOrder: WishlistItem[]) {
    setWish(newOrder);
    if (wishTimer.current) clearTimeout(wishTimer.current);
    wishTimer.current = setTimeout(() => {
      api("/api/me/wishlist/reorder", {
        method: "POST",
        body: JSON.stringify({ ordered: newOrder.map((b) => b.book_id) }),
      }).catch((e: any) => setError(e.message));
    }, 300);
  }

  async function startReadingFromRead(bookId: number) {
    try {
      await api("/api/me/reading", { method: "POST", body: JSON.stringify({ book_id: bookId }) });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeRead(bookId: number) {
    try {
      await api(`/api/me/books/${bookId}`, { method: "DELETE" });
      setBooks((b) => b.filter((x) => x.book_id !== bookId));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function startReadingFromRead(bookId: number) {
    try {
      await api("/api/me/reading", { method: "POST", body: JSON.stringify({ book_id: bookId }) });
      // Mark as reading in the books list
      setBooks((b) => b.map((x) => (x.book_id === bookId ? { ...x, isReading: true } : x)));
      // Add to reading list
      const book = books.find((b) => b.book_id === bookId);
      if (book) {
        setReading((r) => [{ book_id: book.book_id, created_at: Math.floor(Date.now() / 1000), id: book.id, ol_key: book.ol_key, title: book.title, author: book.author, cover_url: book.cover_url, first_publish_year: book.first_publish_year, manual: book.manual }, ...r]);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveReview(bookId: number) {
    setSaving((s) => ({ ...s, [bookId]: true }));
    try {
      await api(`/api/me/books/${bookId}`, {
        method: "PATCH",
        body: JSON.stringify({ review: reviews[bookId] ?? "" }),
      });
      setDirty((d) => ({ ...d, [bookId]: false }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving((s) => ({ ...s, [bookId]: false }));
    }
  }

  async function toggleReadPublic(bookId: number, next: boolean) {
    setBooks((b) => b.map((x) => (x.book_id === bookId ? { ...x, public: next ? 1 : 0 } : x)));
    try {
      await api(`/api/me/books/${bookId}/public`, {
        method: "POST",
        body: JSON.stringify({ public: next }),
      });
    } catch (e: any) {
      setError(e.message);
      load();
    }
  }

  async function toggleOwned(item: WishlistItem) {
    const next = !item.owned;
    setWish((w) => w.map((x) => (x.book_id === item.book_id ? { ...x, owned: next ? 1 : 0 } : x)));
    try {
      await api(`/api/me/wishlist/${item.book_id}/owned`, {
        method: "POST",
        body: JSON.stringify({ owned: next }),
      });
    } catch (e: any) {
      setError(e.message);
      setWish((w) => w.map((x) => (x.book_id === item.book_id ? { ...x, owned: item.owned } : x)));
    }
  }

  async function toggleWishPublic(item: WishlistItem) {
    const next = !item.public;
    setWish((w) => w.map((x) => (x.book_id === item.book_id ? { ...x, public: next ? 1 : 0 } : x)));
    try {
      await api(`/api/me/wishlist/${item.book_id}/public`, {
        method: "POST",
        body: JSON.stringify({ public: next }),
      });
    } catch (e: any) {
      setError(e.message);
      setWish((w) => w.map((x) => (x.book_id === item.book_id ? { ...x, public: item.public } : x)));
    }
  }

  async function moveToRead(item: WishlistItem) {
    try {
      await api(`/api/me/wishlist/${item.book_id}/move-to-read`, { method: "POST", body: "{}" });
      // Remove from wishlist
      setWish((w) => w.filter((x) => x.book_id !== item.book_id));
      // Add to books list
      setBooks((b) => [...b, { ...item, rank: b.length + 1, review: null, isReading: false } as any]);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function startReading(item: WishlistItem) {
    try {
      await api("/api/me/reading", { method: "POST", body: JSON.stringify({ book_id: item.book_id }) });
      // Remove from wishlist
      setWish((w) => w.filter((x) => x.book_id !== item.book_id));
      // Add to reading list
      setReading((r) => [{ book_id: item.book_id, created_at: Math.floor(Date.now() / 1000), id: item.id, ol_key: item.ol_key, title: item.title, author: item.author, cover_url: item.cover_url, first_publish_year: item.first_publish_year, manual: item.manual }, ...r]);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeWish(bookId: number) {
    try {
      await api(`/api/me/wishlist/${bookId}`, {
        method: "DELETE",
      });
      setWish((w) => w.filter((x) => x.book_id !== bookId));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function finishReading(item: ReadingItem) {
    try {
      await api(`/api/me/reading/${item.book_id}/finish`, { method: "POST", body: "{}" });
      // Remove from reading list
      setReading((r) => r.filter((x) => x.book_id !== item.book_id));
      // Check if it's in the books list, if not add it
      const existsInBooks = books.some((b) => b.book_id === item.book_id);
      if (!existsInBooks) {
        setBooks((b) => [...b, { ...item, rank: b.length + 1, review: null, public: 1, isReading: false } as any]);
      } else {
        // Update isReading flag
        setBooks((b) => b.map((x) => (x.book_id === item.book_id ? { ...x, isReading: false } : x)));
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function backToWish(item: ReadingItem) {
    try {
      await api(`/api/me/reading/${item.book_id}/back-to-wishlist`, { method: "POST", body: "{}" });
      // Remove from reading list
      setReading((r) => r.filter((x) => x.book_id !== item.book_id));
      // Add to wishlist
      setWish((w) => [{ ...item, owned: 0, public: 0, rank: w.length + 1 }, ...w]);
      // Update isReading flag in books list if it exists there
      setBooks((b) => b.map((x) => (x.book_id === item.book_id ? { ...x, isReading: false } : x)));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeReading(bookId: number) {
    try {
      await api(`/api/me/reading/${bookId}`, { method: "DELETE" });
      setReading((r) => r.filter((x) => x.book_id !== bookId));
      // Update isReading flag in books list if it exists there
      setBooks((b) => b.map((x) => (x.book_id === bookId ? { ...x, isReading: false } : x)));
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading) return <div className="centered">Loading…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <h2>My Books</h2>
        <p className="muted">
          Books you've read, ranked — and your wishlist. Drag the ⠿ handle to reorder either list.
        </p>
      </div>

      {error && <div className="error">{error}</div>}

      <section className="card">
        <div className="card-head">
          <h3>Currently reading</h3>
          <p className="muted">Always visible to friends.</p>
        </div>
        {reading.length === 0 ? (
          <div className="empty muted">Nothing here. Mark a book “Reading” to track what you're on.</div>
        ) : (
          <ul className="book-list">
            {reading.map((b) => (
              <li key={b.book_id} className="book-row">
                {b.cover_url ? (
                  <img className="cover" src={b.cover_url} alt="" />
                ) : (
                  <span className="cover no-cover">📚</span>
                )}
                <div className="info">
                  <div className="title">
                    <a
                      href={`#/book/${b.book_id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        window.location.hash = `#/book/${b.book_id}`;
                      }}
                      className="book-title-link"
                    >
                      {b.title}
                    </a>
                    {b.manual ? <span className="badge">manual</span> : null}
                  </div>
                  <div className="author">
                    {b.author || "Unknown author"}
                    {b.first_publish_year ? ` · ${b.first_publish_year}` : ""}
                  </div>
                </div>
                <div className="actions">
                  <button className="btn-sm" onClick={() => finishReading(b)} title="Finished — move to My Books">
                    Finished
                  </button>
                  <button className="secondary btn-sm" onClick={() => backToWish(b)} title="Back to wishlist">
                    ↩ Wishlist
                  </button>
                  <button className="danger btn-sm" onClick={() => removeReading(b.book_id)} title="Remove">
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Read</h3>
          <p className="muted">1 = your #1.</p>
        </div>
        {books.length === 0 ? (
          <div className="empty">No books yet. Add some from the “Add Book” page.</div>
        ) : (
          <Reorder.Group axis="y" values={books} onReorder={handleReadReorder} className="book-list">
            {books.map((b, i) => (
              <ReadItem
                key={b.book_id}
                book={b}
                index={i}
                review={reviews[b.book_id] ?? ""}
                dirty={!!dirty[b.book_id]}
                saving={!!saving[b.book_id]}
                reviewOnChange={(v) => {
                  setReviews((r) => ({ ...r, [b.book_id]: v }));
                  setDirty((d) => ({ ...d, [b.book_id]: true }));
                }}
                onSaveReview={() => saveReview(b.book_id)}
                onTogglePublic={(next) => toggleReadPublic(b.book_id, next)}
                onStartReading={() => startReadingFromRead(b.book_id)}
                onRemove={() => removeRead(b.book_id)}
              />
            ))}
          </Reorder.Group>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Wishlist</h3>
          <p className="muted">1 = most wanted.</p>
        </div>
        {wish.length === 0 ? (
          <div className="empty">
            <p className="muted">Nothing here yet. Add a friend's book, or search and pick “♡ Wishlist”.</p>
          </div>
        ) : (
          <Reorder.Group axis="y" values={wish} onReorder={handleWishReorder} className="book-list">
            {wish.map((b, i) => (
              <WishItem
                key={b.book_id}
                item={b}
                index={i}
                onToggleOwned={() => toggleOwned(b)}
                onTogglePublic={() => toggleWishPublic(b)}
                onStartReading={() => startReading(b)}
                onMoveToRead={() => moveToRead(b)}
                onRemove={() => removeWish(b.book_id)}
              />
            ))}
          </Reorder.Group>
        )}
      </section>
    </div>
  );
}

function ReadItem({
  book,
  index,
  review,
  dirty,
  saving,
  reviewOnChange,
  onSaveReview,
  onTogglePublic,
  onStartReading,
  onRemove,
}: {
  book: Book;
  index: number;
  review: string;
  dirty: boolean;
  saving: boolean;
  reviewOnChange: (v: string) => void;
  onSaveReview: () => void;
  onTogglePublic: (next: boolean) => void;
  onStartReading: () => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={book}
      as="li"
      dragListener={false}
      dragControls={controls}
      className="book-row"
      whileDrag={{
        scale: 1.02,
        zIndex: 10,
        boxShadow: "0 12px 28px rgba(0,0,0,0.15)",
      }}
    >
      <button
        type="button"
        className="drag-handle"
        onPointerDown={(e) => controls.start(e)}
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        ⠿
      </button>
      <span className="rank">#{index + 1}</span>
      {book.cover_url ? (
        <img className="cover" src={book.cover_url} alt="" />
      ) : (
        <span className="cover no-cover">📚</span>
      )}
      <div className="info">
        <div className="title">
          <a
            href={`#/book/${book.book_id}`}
            onClick={(e) => {
              e.preventDefault();
              window.location.hash = `#/book/${book.book_id}`;
            }}
            className="book-title-link"
          >
            {book.title}
          </a>
          {book.manual ? <span className="badge">manual</span> : null}
          {book.isReading ? <span className="badge reading">📖 reading</span> : null}
        </div>
        <div className="author">
          {book.author || "Unknown author"}
          {book.first_publish_year ? ` · ${book.first_publish_year}` : ""}
        </div>
        <textarea
          className="review"
          value={review}
          placeholder="Write a review…"
          onChange={(e) => reviewOnChange(e.target.value)}
        />
        {dirty && (
          <button className="save-review" onClick={onSaveReview} disabled={saving}>
            {saving ? "Saving…" : "Save review"}
          </button>
        )}
      </div>
      <div className="actions actions-col">
        <div className="public-col">
          <button
            type="button"
            role="switch"
            aria-checked={!!book.public}
            className={"switch sm" + (book.public ? " on" : "")}
            onClick={() => onTogglePublic(!book.public)}
            title="Visible to friends"
          >
            <span className="knob" />
          </button>
          <span className="muted small-label">{book.public ? "Public" : "Private"}</span>
        </div>
        <button
          className="secondary btn-sm"
          onClick={onStartReading}
          title={book.isReading ? "Already currently reading" : "Currently reading"}
          disabled={book.isReading}
        >
          {book.isReading ? "✓ Reading" : "📖 Reading"}
        </button>
        <button className="danger btn-sm" onClick={onRemove} title="Remove">
          ✕
        </button>
      </div>
    </Reorder.Item>
  );
}

function WishItem({
  item,
  index,
  onToggleOwned,
  onTogglePublic,
  onStartReading,
  onMoveToRead,
  onRemove,
}: {
  item: WishlistItem;
  index: number;
  onToggleOwned: () => void;
  onTogglePublic: () => void;
  onStartReading: () => void;
  onMoveToRead: () => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={item}
      as="li"
      dragListener={false}
      dragControls={controls}
      className="book-row"
      whileDrag={{
        scale: 1.02,
        zIndex: 10,
        boxShadow: "0 12px 28px rgba(0,0,0,0.15)",
      }}
    >
      <button
        type="button"
        className="drag-handle"
        onPointerDown={(e) => controls.start(e)}
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        ⠿
      </button>
      <span className="rank">#{index + 1}</span>
      {item.cover_url ? (
        <img className="cover" src={item.cover_url} alt="" />
      ) : (
        <span className="cover no-cover">📚</span>
      )}
      <div className="info">
        <div className="title">
          <a
            href={`#/book/${item.book_id}`}
            onClick={(e) => {
              e.preventDefault();
              window.location.hash = `#/book/${item.book_id}`;
            }}
            className="book-title-link"
          >
            {item.title}
          </a>
          {item.manual ? <span className="badge">manual</span> : null}
        </div>
        <div className="author">
          {item.author || "Unknown author"}
          {item.first_publish_year ? ` · ${item.first_publish_year}` : ""}
        </div>
        <div className="owned-row">
          <span className="muted">Owned</span>
          <button
            type="button"
            role="switch"
            aria-checked={!!item.owned}
            className={"switch sm" + (item.owned ? " on" : "")}
            onClick={onToggleOwned}
            title="Mark as owned"
          >
            <span className="knob" />
          </button>
          <span className="muted">Public</span>
          <button
            type="button"
            role="switch"
            aria-checked={!!item.public}
            className={"switch sm" + (item.public ? " on" : "")}
            onClick={onTogglePublic}
            title="Visible to friends"
          >
            <span className="knob" />
          </button>
        </div>
      </div>
      <div className="actions actions-col">
        <button className="secondary btn-sm" onClick={onStartReading} title="Start reading">
          📖 Reading
        </button>
        <button className="btn-sm" onClick={onMoveToRead} title="Finished — move to My Books">
          Finished
        </button>
        <button className="danger btn-sm" onClick={onRemove} title="Remove">
          ✕
        </button>
      </div>
    </Reorder.Item>
  );
}
