import { useState, useEffect } from "react";
import { api, Book } from "../api";

interface FriendActivity {
  username: string;
  review: string | null;
  rank: number | null;
  owned: number;
  status: "read" | "wishlist" | "reading";
}

interface BookDetail extends Book {
  friends: FriendActivity[];
}

interface Props {
  bookId: number;
  onBack: () => void;
}

export default function BookDetail({ bookId }: Props) {
  const [book, setBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showAddCover, setShowAddCover] = useState(false);
  const [coverUrl, setCoverUrl] = useState("");

  useEffect(() => {
    loadBook();
  }, [bookId]);

  async function addCoverImage() {
    if (!coverUrl.trim()) return;
    try {
      const response = await api(`/api/books/${bookId}/cover`, {
        method: "POST",
        body: JSON.stringify({ cover_url: coverUrl }),
      });
      setBook(response.book);
      setShowAddCover(false);
      setCoverUrl("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function loadBook() {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ book: BookDetail }>(`/api/books/${bookId}`);
      setBook(data.book);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="centered">Loading...</div>;
  }

  if (error || !book) {
    return (
      <div className="page">
        <div className="error">{error || "Book not found"}</div>
      </div>
    );
  }

  const friendsWithReviews = book.friends.filter(f => f.review && f.status === "read");
  const friendsReading = book.friends.filter(f => f.status === "reading");
  const friendsWishlist = book.friends.filter(f => f.status === "wishlist");
  const friendsRead = book.friends.filter(f => f.status === "read");

  function nextReview() {
    if (friendsWithReviews.length === 0) return;
    setReviewIndex((reviewIndex + 1) % friendsWithReviews.length);
  }

  function prevReview() {
    if (friendsWithReviews.length === 0) return;
    setReviewIndex((reviewIndex - 1 + friendsWithReviews.length) % friendsWithReviews.length);
  }

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
                    <button onClick={addCoverImage} className="btn-sm">Add</button>
                    <button onClick={() => { setShowAddCover(false); setCoverUrl(""); }} className="btn-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowAddCover(true)} className="add-cover-btn">
                  + Add Cover
                </button>
              )}
            </div>
          )}
          <div className="info">
            <div className="title title-lg">{book.title}</div>
            <div className="author">
              {book.author || "Unknown author"}
              {book.first_publish_year && ` · ${book.first_publish_year}`}
              {book.manual && " · "}
              {book.manual && <span className="badge">manual</span>}
            </div>
          </div>
        </div>
      </section>

      {book.synopsis && (
        <section className="card">
          <div className="card-head">
            <h3>Synopsis</h3>
          </div>
          <div className="book-row">
            <div className="info">
              <p className="synopsis-text">{book.synopsis}</p>
            </div>
          </div>
        </section>
      )}

      {friendsReading.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Currently Reading</h3>
            <p className="muted">{friendsReading.length} friend{friendsReading.length !== 1 ? "s" : ""}</p>
          </div>
          <ul className="book-list">
            {friendsReading.map((friend, i) => (
              <li key={i} className="book-row">
                <div className="info">
                  <div className="title">
                    <span className="friend-name">@{friend.username}</span>
                  </div>
                  <div className="author">Currently reading</div>
                </div>
                <div className="actions">
                  <span className="badge reading">📖 Reading</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {friendsWithReviews.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Reviews</h3>
            <p className="muted">
              {reviewIndex + 1} of {friendsWithReviews.length} review{friendsWithReviews.length !== 1 ? "s" : ""}
            </p>
          </div>
          <ul className="book-list">
            <li className="book-row review-row">
              <div className="info">
                <div className="title">
                  <span className="friend-name">@{friendsWithReviews[reviewIndex].username}</span>
                  <span className="review-rank">#{friendsWithReviews[reviewIndex].rank}</span>
                </div>
                <p className="review-text">{friendsWithReviews[reviewIndex].review}</p>
              </div>
            </li>
          </ul>
          {friendsWithReviews.length > 1 && (
            <div className="review-nav">
              <button 
                className="btn-sm secondary" 
                onClick={prevReview}
              >
                ← Previous
              </button>
              <button 
                className="btn-sm secondary" 
                onClick={nextReview}
              >
                Next →
              </button>
            </div>
          )}
        </section>
      )}

      {friendsRead.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Friends Who Read This</h3>
            <p className="muted">{friendsRead.length} friend{friendsRead.length !== 1 ? "s" : ""}</p>
          </div>
          <ul className="book-list">
            {friendsRead.map((friend, i) => (
              <li key={i} className="book-row">
                <div className="info">
                  <div className="title">
                    <span className="friend-name">@{friend.username}</span>
                  </div>
                  <div className="author">Read this book</div>
                </div>
                <div className="actions">
                  <span className="rank">#{friend.rank}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {friendsWishlist.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Friends Who Want to Read This</h3>
            <p className="muted">{friendsWishlist.length} friend{friendsWishlist.length !== 1 ? "s" : ""}</p>
          </div>
          <ul className="book-list">
            {friendsWishlist.map((friend, i) => (
              <li key={i} className="book-row">
                <div className="info">
                  <div className="title">
                    <span className="friend-name">@{friend.username}</span>
                  </div>
                  <div className="author">Wants to read</div>
                </div>
                <div className="actions">
                  {friend.owned ? (
                    <span className="badge owned">Owned</span>
                  ) : (
                    <span className="badge">♡ Wishlist</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {book.friends.length === 0 && (
        <section className="card">
          <div className="empty">
            <p className="muted">None of your friends have this book yet.</p>
          </div>
        </section>
      )}
    </div>
  );
}
