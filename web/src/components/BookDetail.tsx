import { useCallback, useEffect, useState } from "react";
import { api, type Book, errorMessage, type MineStatus } from "../api";
import { Byline } from "./ui/Book";
import { IconBook, IconHeart } from "./ui/icons";
import { StatusPicker } from "./ui/StatusPicker";

interface FriendActivity {
  username: string;
  review: string | null;
  rank: number | null;
  owned: number;
  status: "read" | "wishlist" | "reading";
}

interface MyActivity {
  read: { rank: number; review: string | null; listened: number; public: number } | null;
  wishlist: { rank: number; owned: number; public: number } | null;
  reading: { listening: number } | null;
}

interface BookDetail extends Omit<Book, "mine"> {
  friends: FriendActivity[];
  mine: MyActivity;
}

export default function BookDetail({ bookId }: { bookId: number }) {
  const [book, setBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState("");
  const [showAddCover, setShowAddCover] = useState(false);
  const [coverUrl, setCoverUrl] = useState("");

  async function addCoverImage() {
    if (!coverUrl.trim()) return;
    try {
      const response = await api<{ book: Pick<Book, "cover_url"> }>(`/api/books/${bookId}/cover`, {
        method: "POST",
        body: JSON.stringify({ cover_url: coverUrl }),
      });
      setBook((b) => b && { ...b, cover_url: response.book.cover_url });
      setShowAddCover(false);
      setCoverUrl("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const refresh = useCallback(async () => {
    const data = await api<{ book: BookDetail }>(`/api/books/${bookId}`);
    setBook(data.book);
    setReview(data.book.mine.read?.review ?? "");
  }, [bookId]);

  useEffect(() => {
    setLoading(true);
    setError("");
    refresh()
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function act(path: string, method: string, body: object) {
    setBusy(true);
    setActionError("");
    try {
      await api(path, { method, body: JSON.stringify(body) });
      await refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="loading">Loading…</div>;
  }

  if (error || !book) {
    return (
      <div className="page">
        <div className="error">{error || "Book not found"}</div>
      </div>
    );
  }

  const { mine } = book;
  const status: MineStatus = mine.reading
    ? mine.read
      ? "rereading"
      : "reading"
    : mine.read
      ? "read"
      : mine.wishlist
        ? "wish"
        : null;
  const reviewDirty = review !== (mine.read?.review ?? "");
  const friends = new Map<string, FriendActivity[]>();
  for (const f of book.friends) friends.set(f.username, [...(friends.get(f.username) ?? []), f]);

  return (
    <div className="page">
      <div className="page-head">
        <h2>{book.title}</h2>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Book Details</h3>
        </div>
        <div className="book-row book-detail-row">
          {book.cover_url ? (
            <img src={book.cover_url} alt={book.title} className="cover-lg" />
          ) : (
            <div className="cover-lg no-cover">
              {showAddCover ? (
                <div className="add-cover-form">
                  <input
                    type="url"
                    placeholder="Image URL"
                    value={coverUrl}
                    onChange={(e) => setCoverUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCoverImage()}
                  />
                  <div className="add-cover-buttons">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setShowAddCover(false);
                        setCoverUrl("");
                      }}
                    >
                      Cancel
                    </button>
                    <button type="button" onClick={addCoverImage} className="btn-primary btn-sm">
                      Add
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowAddCover(true)} className="add-cover-btn">
                  + Add Cover
                </button>
              )}
            </div>
          )}
          <div className="info">
            <div className="title title-lg">
              {book.title}
              {book.manual ? <span className="badge">manual</span> : null}
            </div>
            <Byline author={book.author} year={book.first_publish_year} />
            <div className="my-lists">
              <StatusPicker
                status={status}
                book={{ book_id: book.id }}
                onChange={() => refresh().catch((e) => setActionError(errorMessage(e)))}
              />
              {mine.read && (
                <span className="badge accent">
                  Read #{mine.read.rank}
                  {mine.read.listened ? " · Listened" : ""}
                </span>
              )}
              {mine.reading?.listening ? <span className="badge accent">Listening</span> : null}
              {mine.wishlist?.owned ? <WishlistBadge owned /> : null}
            </div>
            {actionError && <div className="error-text">{actionError}</div>}
          </div>
        </div>
      </section>

      {book.synopsis && (
        <section className="card">
          <div className="card-head">
            <h3>Synopsis</h3>
          </div>
          <p className="synopsis-text">{book.synopsis}</p>
        </section>
      )}

      {mine.read && (
        <section className="card">
          <div className="card-head">
            <h3>My Review</h3>
          </div>
          <textarea
            className="review"
            value={review}
            placeholder="Write a review…"
            onChange={(e) => setReview(e.target.value)}
          />
          {reviewDirty && (
            <button
              type="button"
              className="save-review"
              disabled={busy}
              onClick={() => act(`/api/me/books/${book.id}`, "PATCH", { review })}
            >
              {busy ? "Saving…" : "Save review"}
            </button>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h3>Friends</h3>
          {friends.size > 0 && (
            <p className="muted">
              {friends.size} friend{friends.size !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        {friends.size === 0 ? (
          <div className="empty">None of your friends have this book yet.</div>
        ) : (
          <ul className="book-list">
            {[...friends].map(([username, entries]) => (
              <li key={username} className="book-row">
                <div className="info">
                  <div className="friend-book-head">
                    <a className="user-link" href={`#/u/${encodeURIComponent(username)}`}>
                      {username}
                    </a>
                    {entries.map((f) => (
                      <FriendBadge key={f.status} entry={f} />
                    ))}
                  </div>
                  {entries.map(
                    (f) =>
                      f.review && (
                        <div key={f.status} className="review-text">
                          {f.review}
                        </div>
                      ),
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function WishlistBadge({ owned }: { owned: boolean }) {
  return owned ? (
    <span className="badge success">Owned</span>
  ) : (
    <span className="badge">
      <IconHeart size={12} /> Wishlist
    </span>
  );
}

function FriendBadge({ entry }: { entry: FriendActivity }) {
  if (entry.status === "read") return <span className="badge">Read #{entry.rank}</span>;
  if (entry.status === "reading")
    return (
      <span className="badge accent">
        <IconBook size={12} /> Reading
      </span>
    );
  return <WishlistBadge owned={!!entry.owned} />;
}
