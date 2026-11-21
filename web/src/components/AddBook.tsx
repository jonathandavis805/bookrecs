import { useEffect, useState } from "react";
import { api, errorMessage, type SearchHit } from "../api";
import { Byline, Cover } from "./ui/Book";
import { IconBook, IconCheck, IconHeart } from "./ui/icons";
import { Switch } from "./ui/Switch";

export default function AddBook() {
  const [bookCount, setBookCount] = useState(0);
  const [bookLimit, setBookLimit] = useState<number | null>(25); // Default to 25, null = unlimited

  useEffect(() => {
    api<{ bookCount: number; maxBooks: number }>("/api/me/books").then((d) => {
      setBookCount(d.bookCount);
      setBookLimit(d.maxBooks === 0 ? null : d.maxBooks);
    });
  }, []);

  const atLimit = bookLimit !== null && bookCount >= bookLimit;
  const remaining = bookLimit !== null ? bookLimit - bookCount : null;

  return (
    <div className="page">
      <div className="page-head">
        <h2>Add a Book</h2>
        <p className="muted">Search the Open Library — or add a book by hand if it's missing.</p>
        <p className="muted">
          {bookLimit === null
            ? "You have unlimited book slots."
            : atLimit
              ? `You've reached the maximum of ${bookLimit} books.`
              : `${remaining} of ${bookLimit} book slots remaining.`}
        </p>
      </div>
      <SearchPane atLimit={atLimit} onBookAdded={() => setBookCount((c) => c + 1)} />
      <ManualPane atLimit={atLimit} bookLimit={bookLimit} onBookAdded={() => setBookCount((c) => c + 1)} />
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
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      setSearched(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const d = await api<{ results: SearchHit[] }>(`/api/books/search?q=${encodeURIComponent(q.trim())}`);
        setHits(d.results);
        setSearched(true);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [q]);

  async function add(hit: SearchHit, target: "read" | "reading" | "wish") {
    if (target === "read" && atLimit) return;

    const key = `${hit.key}:${target}`;
    setStatus((s) => ({ ...s, [key]: "Adding…" }));
    try {
      if (target === "read") {
        await api("/api/books", {
          method: "POST",
          body: JSON.stringify({ ol_key: hit.key, year: hit.year }),
        });
        setStatus((s) => ({ ...s, [key]: "Added" }));
        onBookAdded();
      } else if (target === "reading") {
        await api("/api/me/reading", {
          method: "POST",
          body: JSON.stringify({ ol_key: hit.key, year: hit.year }),
        });
        setStatus((s) => ({ ...s, [key]: "Reading" }));
      } else {
        await api("/api/me/wishlist", {
          method: "POST",
          body: JSON.stringify({ ol_key: hit.key, year: hit.year }),
        });
        setStatus((s) => ({ ...s, [key]: "Saved" }));
      }
    } catch (err) {
      setStatus((s) => ({ ...s, [key]: errorMessage(err) }));
    }
  }

  return (
    <section className="add-section">
      <div className="search-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or author…" autoFocus />
        {searching && <span className="searching-indicator">Searching…</span>}
      </div>

      {error && <div className="error">{error}</div>}

      <ul className="result-list">
        {hits.map((h) => {
          const readS = status[`${h.key}:read`];
          const read2 = status[`${h.key}:reading`];
          const wishS = status[`${h.key}:wish`];
          return (
            <li key={h.key} className="book-row">
              <Cover url={h.coverUrl} />
              <div className="info">
                <div className="title">
                  {h.title}
                  {h.added && (
                    <span className="added-mark" title="Added by someone">
                      <IconCheck size={14} />
                    </span>
                  )}
                </div>
                <Byline author={h.author} year={h.year} />
              </div>
              <div className="actions">
                {readS === "Added" ? (
                  <span className="success-text">Added</span>
                ) : readS && readS !== "Adding…" ? (
                  <span className="error-text">{readS}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => add(h, "read")}
                    disabled={readS === "Adding…" || atLimit}
                    title={atLimit ? "Book limit reached" : ""}
                  >
                    {readS === "Adding…" ? "…" : atLimit ? "Limit reached" : "My Books"}
                  </button>
                )}
                {read2 === "Reading" ? (
                  <span className="success-text">Reading</span>
                ) : read2 && read2 !== "Adding…" ? (
                  <span className="error-text">{read2}</span>
                ) : (
                  <button type="button" onClick={() => add(h, "reading")} disabled={read2 === "Adding…"}>
                    {read2 === "Adding…" ? (
                      "…"
                    ) : (
                      <>
                        <IconBook /> Reading
                      </>
                    )}
                  </button>
                )}
                {wishS === "Saved" ? (
                  <span className="success-text">Saved</span>
                ) : wishS && wishS !== "Adding…" ? (
                  <span className="error-text">{wishS}</span>
                ) : (
                  <button type="button" onClick={() => add(h, "wish")} disabled={wishS === "Adding…"}>
                    {wishS === "Adding…" ? (
                      "…"
                    ) : (
                      <>
                        <IconHeart /> Wishlist
                      </>
                    )}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {searched && hits.length === 0 && !error && (
        <div className="empty">
          <p>No matches for "{q}".</p>
          <p className="muted">Add it by hand using the form below.</p>
        </div>
      )}
    </section>
  );
}

function ManualPane({ atLimit, bookLimit, onBookAdded }: PaneProps) {
  const [target, setTarget] = useState<"read" | "reading" | "wish">("read");
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
      setIsPublic(target === "read");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-section">
      <h3 className="section-title">Can't find your book? Add it manually</h3>

      <div className="segmented">
        <button
          type="button"
          className={target === "read" ? "active" : ""}
          onClick={() => {
            setTarget("read");
            setIsPublic(true);
          }}
        >
          My Books
        </button>
        <button type="button" className={target === "reading" ? "active" : ""} onClick={() => setTarget("reading")}>
          Reading
        </button>
        <button
          type="button"
          className={target === "wish" ? "active" : ""}
          onClick={() => {
            setTarget("wish");
            setIsPublic(false);
          }}
        >
          Wishlist
        </button>
      </div>

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
