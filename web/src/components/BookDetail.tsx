import { useState } from "react";
import { api, type Book, errorMessage, type MineStatus } from "../api";
import { useData } from "../useData";
import { Byline } from "./ui/Book";
import { readingStatus, readStatus, StatusPicker } from "./ui/StatusPicker";

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
  const { data, error: loadError, update, reload } = useData<{ book: BookDetail }>(`/api/books/${bookId}`);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  // A review typed but not saved.
  const [draft, setDraft] = useState<string | null>(null);
  const [showAddCover, setShowAddCover] = useState(false);
  const [coverUrl, setCoverUrl] = useState("");

  async function addCoverImage() {
    if (!coverUrl.trim()) return;
    try {
      const response = await api<{ book: Pick<Book, "cover_url"> }>(`/api/books/${bookId}/cover`, {
        method: "POST",
        body: JSON.stringify({ cover_url: coverUrl }),
      });
      update((d) => ({ book: { ...d.book, cover_url: response.book.cover_url } }));
      setShowAddCover(false);
      setCoverUrl("");
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  async function saveReview(review: string) {
    setBusy(true);
    setActionError("");
    try {
      await api(`/api/me/books/${bookId}`, { method: "PATCH", body: JSON.stringify({ review }) });
      await reload();
      setDraft(null);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return loadError ? <div className="error">{loadError}</div> : <div className="loading">Loading…</div>;
  }

  const { book } = data;
  const { mine } = book;
  const status: MineStatus = mine.reading
    ? readingStatus(mine.reading.listening, !!mine.read)
    : mine.read
      ? readStatus(mine.read.listened)
      : mine.wishlist
        ? "wish"
        : null;
  const saved = mine.read?.review ?? "";
  const review = draft ?? saved;
  const friends = new Map<string, FriendActivity[]>();
  for (const f of book.friends) friends.set(f.username, [...(friends.get(f.username) ?? []), f]);

  return (
    <div className="page">
      <div className="book-head">
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
          <h2>{book.title}</h2>
          <Byline
            author={book.author}
            year={book.first_publish_year}
            extra={book.manual ? "added by hand" : undefined}
          />
          <div className="my-lists">
            <StatusPicker status={status} book={{ book_id: book.id }} onChange={() => reload()} />
            {mine.read && <span className="muted">Ranked #{mine.read.rank}</span>}
            {mine.wishlist && (
              <span className="muted">
                #{mine.wishlist.rank} on your wishlist{mine.wishlist.owned ? " · Owned" : ""}
              </span>
            )}
          </div>
          {actionError && <div className="error-text">{actionError}</div>}
        </div>
      </div>

      {mine.read && (
        <section>
          <h3 className="section-title">Your review</h3>
          <textarea
            className="review"
            value={review}
            placeholder="Write a review…"
            onChange={(e) => setDraft(e.target.value)}
          />
          {review !== saved && (
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => saveReview(review)}>
              {busy ? "Saving…" : "Save review"}
            </button>
          )}
        </section>
      )}

      {friends.size > 0 && (
        <section>
          <h3 className="section-title">Friends</h3>
          <ul className="book-list">
            {[...friends].map(([username, entries]) => (
              <li key={username} className="book-row">
                <div className="info">
                  <div className="friend-book-head">
                    <a className="user-link" href={`#/u/${encodeURIComponent(username)}`}>
                      {username}
                    </a>
                    <span className="muted">{entries.map(describe).join(" · ")}</span>
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
        </section>
      )}

      {book.synopsis && (
        <section>
          <h3 className="section-title">Synopsis</h3>
          {/* Open Library's synopses carry Markdown emphasis. */}
          <p className="synopsis-text">{book.synopsis.replace(/\*+/g, "")}</p>
        </section>
      )}
    </div>
  );
}

function describe(entry: FriendActivity): string {
  if (entry.status === "read") return `Read, #${entry.rank}`;
  if (entry.status === "reading") return "Reading";
  return entry.owned ? "Owns it" : "On their wishlist";
}
