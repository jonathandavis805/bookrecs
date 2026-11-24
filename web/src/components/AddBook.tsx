import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type MineStatus } from "../api";
import { useBookSearch } from "../useBookSearch";
import { Byline, Cover } from "./ui/Book";
import { type Status, StatusChoice, StatusPicker } from "./ui/StatusPicker";
import { Switch } from "./ui/Switch";

// Fewer books left than this is worth mentioning.
const SLOTS_WARNING = 5;

export default function AddBook() {
  const [manual, setManual] = useState(false);
  const [bookCount, setBookCount] = useState(0);
  const [bookLimit, setBookLimit] = useState<number | null>(25); // Default to 25, null = unlimited

  const loadCount = useCallback(async () => {
    const d = await api<{ bookCount: number; maxBooks: number }>("/api/me/books");
    setBookCount(d.bookCount);
    setBookLimit(d.maxBooks === 0 ? null : d.maxBooks);
  }, []);

  useEffect(() => {
    loadCount();
  }, [loadCount]);

  const atLimit = bookLimit !== null && bookCount >= bookLimit;
  const remaining = bookLimit !== null ? bookLimit - bookCount : null;

  return (
    <div className="page">
      <SearchPane atLimit={atLimit} onBookAdded={loadCount} />
      {manual ? (
        <ManualPane atLimit={atLimit} bookLimit={bookLimit} onBookAdded={loadCount} />
      ) : (
        <p className="muted">
          Can't find it?{" "}
          <button type="button" className="link" onClick={() => setManual(true)}>
            Add it by hand
          </button>
        </p>
      )}
      {remaining !== null && remaining <= SLOTS_WARNING && (
        <p className="muted">
          {atLimit
            ? `You've reached the maximum of ${bookLimit} books read.`
            : `${remaining} of ${bookLimit} books read left.`}
        </p>
      )}
    </div>
  );
}

interface PaneProps {
  atLimit: boolean;
  bookLimit: number | null;
  onBookAdded: () => void;
}

function SearchPane({ atLimit, onBookAdded }: Omit<PaneProps, "bookLimit">) {
  const [q, setQ] = useState("");
  const { hits, searched, searching, error } = useBookSearch(q);
  // Books moved between my lists since the search ran.
  const [moved, setMoved] = useState<Record<string, MineStatus>>({});

  return (
    <section className="add-section">
      <div className="search-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or author…" autoFocus />
        {searching && <span className="searching-indicator">Searching…</span>}
      </div>

      {error && <div className="error">{error}</div>}

      {hits.length > 0 && (
        <ul className="result-list">
          {hits.map((h) => (
            <li key={h.key} className="book-row">
              <Cover url={h.coverUrl} />
              <div className="info">
                <div className="title">{h.title}</div>
                <Byline author={h.author} year={h.year} />
              </div>
              <div className="actions">
                <StatusPicker
                  status={moved[h.key] ?? h.mine}
                  book={{ ol_key: h.key, year: h.year }}
                  atLimit={atLimit}
                  onChange={(next) => {
                    setMoved((m) => ({ ...m, [h.key]: next }));
                    onBookAdded();
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {searched && hits.length === 0 && !error && <div className="empty">No matches for "{searched}".</div>}
    </section>
  );
}

function ManualPane({ atLimit, bookLimit, onBookAdded }: PaneProps) {
  const [target, setTarget] = useState<Status>("read");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (target === "read" && atLimit) return;

    setError("");
    setBusy(true);
    setDone("");
    try {
      const body = JSON.stringify({ title, author, year, coverUrl, public: isPublic });
      if (target === "read") {
        await api("/api/books/manual", { method: "POST", body });
        setDone('Added — find it in your "My Books" list.');
        onBookAdded();
      } else if (target === "reading") {
        await api("/api/me/reading/manual", {
          method: "POST",
          body: JSON.stringify({ title, author, year, coverUrl }),
        });
        setDone('Now reading — find it in "Currently reading".');
      } else {
        await api("/api/me/wishlist/manual", { method: "POST", body });
        setDone('Saved — find it in your "Wishlist".');
      }
      setTitle("");
      setAuthor("");
      setYear("");
      setCoverUrl("");
      setIsPublic(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-section">
      <h3 className="section-title">Add by hand</h3>

      <StatusChoice value={target} onChange={setTarget} />

      {done && <div className="success">{done}</div>}
      {error && <div className="error">{error}</div>}
      {atLimit && target === "read" && bookLimit !== null && (
        <div className="error">You've reached the maximum of {bookLimit} books. Remove a book to add another.</div>
      )}

      <form className="card form" onSubmit={submit}>
        <label className="field">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Book title" required />
        </label>
        <label className="field">
          Author
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author" />
        </label>
        <div className="row-fields">
          <label className="field">
            Year
            <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 1987" inputMode="numeric" />
          </label>
          <label className="field grow">
            Cover URL (optional)
            <input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://…/cover.jpg" />
          </label>
        </div>
        {target === "reading" ? (
          <div className="muted">Currently reading is always visible to friends.</div>
        ) : (
          <div className="toggle-row">
            <span className="muted">Public</span>
            <Switch checked={isPublic} onChange={setIsPublic} label="Public" />
            <span className="muted">{isPublic ? "Friends can see it" : "Private"}</span>
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={busy || (atLimit && target === "read")}>
          {busy
            ? "Adding…"
            : atLimit && target === "read"
              ? "Book limit reached"
              : target === "read"
                ? "Add to My Books"
                : target === "reading"
                  ? "Start reading"
                  : "Add to Wishlist"}
        </button>
      </form>
    </section>
  );
}
