import { Reorder, useDragControls } from "framer-motion";
import { useEffect, useState } from "react";
import { api, type Book, errorMessage, type NextUpItem, type ReadingItem, type User, type WishlistItem } from "../api";
import { Byline, Cover } from "./ui/Book";
import { IconBook, IconCheck, IconChevronDown, IconGrip, IconHeart, IconUndo, IconX } from "./ui/icons";
import { Switch } from "./ui/Switch";

interface Props {
  username: string;
  me: User;
}

type Mine = "read" | "wish" | "reading" | null;

export default function Profile({ username, me }: Props) {
  const isSelf = username.toLowerCase() === me.username.toLowerCase();

  const [books, setBooks] = useState<Book[] | null>(null);
  const [wish, setWish] = useState<WishlistItem[] | null>(null);
  const [reading, setReading] = useState<ReadingItem[] | null>(null);
  const [nextUp, setNextUp] = useState<NextUpItem | null>(null);
  const [readError, setReadError] = useState("");
  const [wishStatus, setWishStatus] = useState<Record<number, string>>({});
  const [readingStatus, setReadingStatus] = useState<Record<number, string>>({});

  // Edit state for self
  const [reviews, setReviews] = useState<Record<number, string>>({});
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setBooks(null);
    setWish(null);
    setReading(null);
    setNextUp(null);
    setReadError("");

    const readPath = isSelf ? "/api/me/books" : `/api/friends/${encodeURIComponent(username)}/books`;
    api<{ books: Book[] }>(readPath)
      .then((d) => {
        if (!cancelled) {
          setBooks(d.books);
          if (isSelf) {
            const rv: Record<number, string> = {};
            d.books.forEach((b) => {
              if (b.review != null) rv[b.book_id] = b.review;
            });
            setReviews(rv);
          }
        }
      })
      .catch((e) => !cancelled && setReadError(errorMessage(e)));

    const wishPath = isSelf ? "/api/me/wishlist" : `/api/friends/${encodeURIComponent(username)}/wishlist`;
    api<{ books: WishlistItem[] }>(wishPath)
      .then((d) => !cancelled && setWish(d.books))
      .catch(() => {});

    const readingPath = isSelf ? "/api/me/reading" : `/api/friends/${encodeURIComponent(username)}/reading`;
    api<{ books: ReadingItem[] }>(readingPath)
      .then((d) => !cancelled && setReading(d.books))
      .catch(() => {});

    if (isSelf) {
      api<{ books: NextUpItem[] }>("/api/me/next-up")
        .then((d) => !cancelled && setNextUp(d.books[0] || null))
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [username, isSelf]);

  // Refetches every list after a move between them; next-up depends on all three.
  async function reloadMine() {
    const [r, w, g, next] = await Promise.all([
      api<{ books: Book[] }>("/api/me/books"),
      api<{ books: WishlistItem[] }>("/api/me/wishlist"),
      api<{ books: ReadingItem[] }>("/api/me/reading"),
      api<{ books: NextUpItem[] }>("/api/me/next-up"),
    ]);
    setBooks(r.books);
    setWish(w.books);
    setReading(g.books);
    setNextUp(next.books[0] || null);
  }

  // Edit handlers for self
  async function saveReview(bookId: number) {
    setSaving((s) => ({ ...s, [bookId]: true }));
    try {
      await api(`/api/me/books/${bookId}`, {
        method: "PATCH",
        body: JSON.stringify({ review: reviews[bookId] ?? "" }),
      });
      setDirty((d) => ({ ...d, [bookId]: false }));
    } catch (e) {
      setReadError(errorMessage(e));
    } finally {
      setSaving((s) => ({ ...s, [bookId]: false }));
    }
  }

  async function toggleReadPublic(bookId: number, next: boolean) {
    setBooks((b) => (b ? b.map((x) => (x.book_id === bookId ? { ...x, public: next ? 1 : 0 } : x)) : b));
    try {
      await api(`/api/me/books/${bookId}/public`, {
        method: "POST",
        body: JSON.stringify({ public: next }),
      });
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function toggleOwned(item: WishlistItem) {
    const next = !item.owned;
    setWish((w) => (w ? w.map((x) => (x.book_id === item.book_id ? { ...x, owned: next ? 1 : 0 } : x)) : w));
    try {
      await api(`/api/me/wishlist/${item.book_id}/owned`, {
        method: "POST",
        body: JSON.stringify({ owned: next }),
      });
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function toggleWishPublic(item: WishlistItem) {
    const next = !item.public;
    setWish((w) => (w ? w.map((x) => (x.book_id === item.book_id ? { ...x, public: next ? 1 : 0 } : x)) : w));
    try {
      await api(`/api/me/wishlist/${item.book_id}/public`, {
        method: "POST",
        body: JSON.stringify({ public: next }),
      });
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function startReading(bookId: number) {
    try {
      await api("/api/me/reading", { method: "POST", body: JSON.stringify({ book_id: bookId }) });
      await reloadMine();
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function removeRead(bookId: number) {
    try {
      await api(`/api/me/books/${bookId}`, { method: "DELETE" });
      setBooks((b) => (b ? b.filter((x) => x.book_id !== bookId) : b));
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function removeWish(bookId: number) {
    try {
      await api(`/api/me/wishlist/${bookId}`, { method: "DELETE" });
      setWish((w) => (w ? w.filter((x) => x.book_id !== bookId) : w));
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function startReadingFromNextUp(bookId: number) {
    try {
      await api("/api/me/reading/from-wishlist", { method: "POST", body: JSON.stringify({ book_id: bookId }) });
      await reloadMine();
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function removeReading(bookId: number) {
    try {
      await api(`/api/me/reading/${bookId}`, { method: "DELETE" });
      await reloadMine();
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function finishReading(item: ReadingItem) {
    try {
      await api(`/api/me/reading/${item.book_id}/finish`, { method: "POST", body: "{}" });
      await reloadMine();
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function backToWishlist(item: ReadingItem) {
    try {
      await api(`/api/me/reading/${item.book_id}/back-to-wishlist`, { method: "POST", body: "{}" });
      await reloadMine();
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function moveToRead(item: WishlistItem) {
    try {
      await api(`/api/me/wishlist/${item.book_id}/move-to-read`, { method: "POST", body: "{}" });
      await reloadMine();
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  function handleReadReorder(newOrder: Book[]) {
    setBooks(newOrder);
    api("/api/me/books/reorder", {
      method: "POST",
      body: JSON.stringify({ ordered: newOrder.map((b) => b.book_id) }),
    }).catch((e) => setReadError(errorMessage(e)));
  }

  function handleWishReorder(newOrder: WishlistItem[]) {
    setWish(newOrder);
    api("/api/me/wishlist/reorder", {
      method: "POST",
      body: JSON.stringify({ ordered: newOrder.map((b) => b.book_id) }),
    }).catch((e) => setReadError(errorMessage(e)));
  }

  async function addWish(bookId: number) {
    setWishStatus((s) => ({ ...s, [bookId]: "Adding…" }));
    try {
      await api("/api/me/wishlist", { method: "POST", body: JSON.stringify({ book_id: bookId }) });
      setWishStatus((s) => ({ ...s, [bookId]: "Saved" }));
    } catch (e) {
      setWishStatus((s) => ({ ...s, [bookId]: errorMessage(e) }));
    }
  }

  async function addReading(bookId: number) {
    setReadingStatus((s) => ({ ...s, [bookId]: "Adding…" }));
    try {
      await api("/api/me/reading", { method: "POST", body: JSON.stringify({ book_id: bookId }) });
      setReadingStatus((s) => ({ ...s, [bookId]: "Reading" }));
    } catch (e) {
      setReadingStatus((s) => ({ ...s, [bookId]: errorMessage(e) }));
    }
  }

  function actions(bookId: number, mine: Mine | undefined) {
    if (isSelf) return null;

    if (mine === "reading") {
      return <span className="muted">In your reading</span>;
    }

    const r = readingStatus[bookId];
    const w = wishStatus[bookId];

    const readingBtn =
      r === "Reading" ? (
        <span className="success-text">Reading</span>
      ) : r && r !== "Adding…" ? (
        <span className="error-text">{r}</span>
      ) : (
        <button type="button" onClick={() => addReading(bookId)} disabled={r === "Adding…"}>
          {r === "Adding…" ? (
            "…"
          ) : (
            <>
              <IconBook /> Reading
            </>
          )}
        </button>
      );

    let wishBtn: React.ReactNode;
    if (mine === "read") wishBtn = <span className="muted">In your books</span>;
    else if (mine === "wish") wishBtn = <span className="muted">In your wishlist</span>;
    else if (w === "Saved") wishBtn = <span className="success-text">Saved</span>;
    else if (w && w !== "Adding…") wishBtn = <span className="error-text">{w}</span>;
    else
      wishBtn = (
        <button type="button" onClick={() => addWish(bookId)} disabled={w === "Adding…"}>
          {w === "Adding…" ? (
            "…"
          ) : (
            <>
              <IconHeart /> Wishlist
            </>
          )}
        </button>
      );

    return (
      <>
        {readingBtn}
        {wishBtn}
      </>
    );
  }

  return (
    <div className="page">
      {readError && (
        <div className="error">
          {isSelf ? readError : `You're not friends with @${username} yet. Add them in "Friends" to see their books.`}
        </div>
      )}

      {!readError && (
        <section className="card">
          <h2 className="section-title">Currently reading</h2>
          {reading === null ? (
            <div className="loading">Loading…</div>
          ) : reading.length === 0 ? (
            <div className="empty muted">
              {isSelf
                ? 'Nothing here. Mark a book "Reading" to track what you\'re on.'
                : `@${username} isn't reading anything right now.`}
            </div>
          ) : (
            <ul className="book-list">
              {reading.map((b) => (
                <li key={b.book_id} className="book-row">
                  <Cover url={b.cover_url} />
                  <div className="info">
                    <div className="title">
                      <a href={`#/book/${b.book_id}`} className="book-title-link">
                        {b.title}
                      </a>
                      {b.manual ? <span className="badge">manual</span> : null}
                    </div>
                    <Byline author={b.author} year={b.first_publish_year} />
                  </div>
                  {isSelf ? (
                    <div className="actions">
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => finishReading(b)}
                        title="Finished — move to Books read"
                      >
                        Finished
                      </button>
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => backToWishlist(b)}
                        title="Back to wishlist"
                      >
                        <IconUndo /> Wishlist
                      </button>
                      <button
                        type="button"
                        className="icon-btn remove"
                        onClick={() => removeReading(b.book_id)}
                        title="Remove"
                        aria-label="Remove"
                      >
                        <IconX />
                      </button>
                    </div>
                  ) : (
                    <div className="actions">{actions(b.book_id, b.mine)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isSelf && nextUp && (
            <>
              <h3 className="subsection-title">Next up</h3>
              <ul className="book-list">
                <li className="book-row">
                  <Cover url={nextUp.cover_url} />
                  <div className="info">
                    <div className="title">
                      <a href={`#/book/${nextUp.book_id}`} className="book-title-link">
                        {nextUp.title}
                      </a>
                      {nextUp.manual ? <span className="badge">manual</span> : null}
                    </div>
                    <Byline author={nextUp.author} year={nextUp.first_publish_year} />
                    <div className="author">
                      {nextUp.reason === "owned"
                        ? `You own this · #${nextUp.rank} on wishlist`
                        : `@${nextUp.friendUsername} has this · #${nextUp.rank} on wishlist`}
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => startReadingFromNextUp(nextUp.book_id)}
                      title="Start reading"
                    >
                      <IconBook /> Reading
                    </button>
                  </div>
                </li>
              </ul>
            </>
          )}
        </section>
      )}

      {!readError && (
        <section className="card">
          <h2 className="section-title">Books read</h2>
          {books === null ? (
            <div className="loading">Loading…</div>
          ) : books.length === 0 ? (
            <div className="empty muted">
              {isSelf ? 'No books yet. Add some from the "Add Book" page.' : "No public books yet."}
            </div>
          ) : isSelf ? (
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
                  onStartReading={() => startReading(b.book_id)}
                  onRemove={() => removeRead(b.book_id)}
                />
              ))}
            </Reorder.Group>
          ) : (
            <ol className="book-list">
              {books.map((b, i) => (
                <li key={b.book_id} className="book-row">
                  <span className="rank">#{i + 1}</span>
                  <Cover url={b.cover_url} />
                  <div className="info">
                    <div className="title">
                      <a href={`#/book/${b.book_id}`} className="book-title-link">
                        {b.title}
                      </a>
                    </div>
                    <Byline author={b.author} year={b.first_publish_year} />
                    {b.review && <div className="review-text">{b.review}</div>}
                  </div>
                  <div className="actions">{actions(b.book_id, b.mine)}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {!readError && (
        <section className="card">
          <h2 className="section-title">Wishlist</h2>
          {wish === null ? (
            <div className="loading">Loading…</div>
          ) : wish.length === 0 ? (
            <div className="empty">
              <p className="muted">
                {isSelf
                  ? 'Nothing here yet. Add a friend\'s book, or search and pick "Wishlist".'
                  : `@${username} has no public wishlist items yet.`}
              </p>
            </div>
          ) : isSelf ? (
            <Reorder.Group axis="y" values={wish} onReorder={handleWishReorder} className="book-list">
              {wish.map((b, i) => (
                <WishItem
                  key={b.book_id}
                  item={b}
                  index={i}
                  onToggleOwned={() => toggleOwned(b)}
                  onTogglePublic={() => toggleWishPublic(b)}
                  onStartReading={() => startReading(b.book_id)}
                  onMoveToRead={() => moveToRead(b)}
                  onRemove={() => removeWish(b.book_id)}
                />
              ))}
            </Reorder.Group>
          ) : (
            <ul className="book-list">
              {wish.map((b) => (
                <li key={b.book_id} className="book-row">
                  <Cover url={b.cover_url} />
                  <div className="info">
                    <div className="title">
                      <a href={`#/book/${b.book_id}`} className="book-title-link">
                        {b.title}
                      </a>
                      {b.manual ? <span className="badge">manual</span> : null}
                    </div>
                    <Byline author={b.author} year={b.first_publish_year} />
                    {b.owned ? <div className="author">Owned</div> : null}
                  </div>
                  <div className="actions">{actions(b.book_id, b.mine)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

const DRAGGING = { scale: 1.02, zIndex: 10, boxShadow: "0 12px 28px rgba(0,0,0,0.15)" };

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
  const [reviewOpen, setReviewOpen] = useState(false);

  return (
    <Reorder.Item
      value={book}
      as="li"
      dragListener={false}
      dragControls={controls}
      className="book-row"
      whileDrag={DRAGGING}
    >
      <button
        type="button"
        className="drag-handle"
        onPointerDown={(e) => controls.start(e)}
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <IconGrip size={18} />
      </button>
      <span className="rank">#{index + 1}</span>
      <Cover url={book.cover_url} />
      <div className="info">
        <div className="title">
          <a href={`#/book/${book.book_id}`} className="book-title-link">
            {book.title}
          </a>
          {book.manual ? <span className="badge">manual</span> : null}
          {book.isReading ? <span className="badge accent">Reading</span> : null}
        </div>
        <Byline author={book.author} year={book.first_publish_year} />
        <button
          type="button"
          className={`review-toggle${reviewOpen ? " open" : ""}`}
          onClick={() => setReviewOpen((o) => !o)}
        >
          {reviewOpen ? "Hide review" : review.trim() ? "Edit review" : "Add review"}
          <IconChevronDown size={12} />
        </button>
        <div className={`review-box${reviewOpen ? " open" : ""}`}>
          <textarea
            className="review"
            value={review}
            placeholder="Write a review…"
            onChange={(e) => reviewOnChange(e.target.value)}
          />
          {dirty && (
            <button type="button" className="save-review" onClick={onSaveReview} disabled={saving}>
              {saving ? "Saving…" : "Save review"}
            </button>
          )}
        </div>
      </div>
      <div className="actions actions-col">
        <div className="public-col">
          <Switch checked={!!book.public} onChange={onTogglePublic} title="Visible to friends" />
          <span className="small-label">{book.public ? "Public" : "Private"}</span>
        </div>
        <button
          type="button"
          className="btn-sm"
          onClick={onStartReading}
          title={book.isReading ? "Already currently reading" : "Currently reading"}
          disabled={book.isReading}
        >
          {book.isReading ? <IconCheck /> : <IconBook />} Reading
        </button>
        <button type="button" className="icon-btn remove" onClick={onRemove} title="Remove" aria-label="Remove">
          <IconX />
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
      whileDrag={DRAGGING}
    >
      <button
        type="button"
        className="drag-handle"
        onPointerDown={(e) => controls.start(e)}
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <IconGrip size={18} />
      </button>
      <span className="rank">#{index + 1}</span>
      <Cover url={item.cover_url} />
      <div className="info">
        <div className="title">
          <a href={`#/book/${item.book_id}`} className="book-title-link">
            {item.title}
          </a>
          {item.manual ? <span className="badge">manual</span> : null}
        </div>
        <Byline author={item.author} year={item.first_publish_year} />
        <div className="toggle-row">
          <span className="muted">Owned</span>
          <Switch checked={!!item.owned} onChange={onToggleOwned} title="Mark as owned" />
          <span className="muted">Public</span>
          <Switch checked={!!item.public} onChange={onTogglePublic} title="Visible to friends" />
        </div>
      </div>
      <div className="actions actions-col">
        <button type="button" className="btn-sm" onClick={onStartReading} title="Start reading">
          <IconBook /> Reading
        </button>
        <button type="button" className="btn-sm" onClick={onMoveToRead} title="Finished — move to Books read">
          Finished
        </button>
        <button type="button" className="icon-btn remove" onClick={onRemove} title="Remove" aria-label="Remove">
          <IconX />
        </button>
      </div>
    </Reorder.Item>
  );
}
