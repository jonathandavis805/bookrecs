import { useCallback, useEffect, useState } from "react";
import { api, type Book, errorMessage } from "../api";
import { Byline } from "./ui/Book";
import { IconBook, IconChevronLeft, IconChevronRight, IconHeart } from "./ui/icons";

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

export default function BookDetail({ bookId }: { bookId: number }) {
  const [book, setBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showAddCover, setShowAddCover] = useState(false);
  const [coverUrl, setCoverUrl] = useState("");

  async function addCoverImage() {
    if (!coverUrl.trim()) return;
    try {
      const response = await api<{ book: BookDetail }>(`/api/books/${bookId}/cover`, {
        method: "POST",
        body: JSON.stringify({ cover_url: coverUrl }),
      });
      setBook(response.book);
      setShowAddCover(false);
      setCoverUrl("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const loadBook = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ book: BookDetail }>(`/api/books/${bookId}`);
      setBook(data.book);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    loadBook();
  }, [loadBook]);

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

  const friendsWithReviews = book.friends.filter((f) => f.review && f.status === "read");
  const friendsReading = book.friends.filter((f) => f.status === "reading");
  const friendsWishlist = book.friends.filter((f) => f.status === "wishlist");
  const friendsRead = book.friends.filter((f) => f.status === "read");

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
                    <button
                      type="button"
                      className="btn-sm"
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
            <p className="muted">
              {friendsReading.length} friend{friendsReading.length !== 1 ? "s" : ""}
            </p>
          </div>
          <ul className="book-list">
            {friendsReading.map((friend) => (
              <li key={friend.username} className="book-row">
                <div className="info">
                  <div className="title">
                    <span className="friend-name">@{friend.username}</span>
                  </div>
                  <div className="author">Currently reading</div>
                </div>
                <div className="actions">
                  <span className="badge accent">
                    <IconBook size={12} /> Reading
                  </span>
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
              <button type="button" className="btn-sm" onClick={prevReview}>
                <IconChevronLeft /> Previous
              </button>
              <button type="button" className="btn-sm" onClick={nextReview}>
                Next <IconChevronRight />
              </button>
            </div>
          )}
        </section>
      )}

      {friendsRead.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Friends Who Read This</h3>
            <p className="muted">
              {friendsRead.length} friend{friendsRead.length !== 1 ? "s" : ""}
            </p>
          </div>
          <ul className="book-list">
            {friendsRead.map((friend) => (
              <li key={friend.username} className="book-row">
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
            <p className="muted">
              {friendsWishlist.length} friend{friendsWishlist.length !== 1 ? "s" : ""}
            </p>
          </div>
          <ul className="book-list">
            {friendsWishlist.map((friend) => (
              <li key={friend.username} className="book-row">
                <div className="info">
                  <div className="title">
                    <span className="friend-name">@{friend.username}</span>
                  </div>
                  <div className="author">Wants to read</div>
                </div>
                <div className="actions">
                  {friend.owned ? (
                    <span className="badge success">Owned</span>
                  ) : (
                    <span className="badge">
                      <IconHeart size={12} /> Wishlist
                    </span>
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
