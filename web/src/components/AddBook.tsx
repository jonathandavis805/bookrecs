import { useState, useEffect } from "react";
import { api, SearchHit } from "../api";

export default function AddBook() {
  return (
    <div className="page">
      <div className="page-head">
        <h2>Add a Book</h2>
        <p className="muted">Search the Open Library — or add a book by hand if it's missing.</p>
      </div>
      <SearchPane />
      <ManualPane />
    </div>
  );
}

function SearchPane() {
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
        const d = await api<{ results: SearchHit[] }>(
          "/api/books/search?q=" + encodeURIComponent(q.trim())
        );
        setHits(d.results);
        setSearched(true);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [q]);

  async function add(hit: SearchHit, target: "read" | "reading" | "wish") {
    const key = `${hit.key}:${target}`;
    setStatus((s) => ({ ...s, [key]: "Adding…" }));
    try {
      if (target === "read") {
        await api("/api/books", {
          method: "POST",
          body: JSON.stringify({ ol_key: hit.key, year: hit.year }),
        });
        setStatus((s) => ({ ...s, [key]: "Added ✓" }));
      } else if (target === "reading") {
        await api("/api/me/reading", {
          method: "POST",
          body: JSON.stringify({ ol_key: hit.key, year: hit.year }),
        });
        setStatus((s) => ({ ...s, [key]: "Reading ✓" }));
      } else {
        await api("/api/me/wishlist", {
          method: "POST",
          body: JSON.stringify({ ol_key: hit.key, year: hit.year }),
        });
        setStatus((s) => ({ ...s, [key]: "Saved ✓" }));
      }
    } catch (err: any) {
      setStatus((s) => ({ ...s, [key]: err.message }));
    }
  }

  return (
    <section className="add-section">
      <div className="search-bar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Title or author…"
          autoFocus
        />
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
              {h.coverUrl ? (
                <img className="cover" src={h.coverUrl} alt="" />
              ) : (
                <span className="cover no-cover">📚</span>
              )}
              <div className="info">
                <div className="title">
                  {h.title}
                  {h.added && <span className="added-badge" title="Added by someone">✓</span>}
                </div>
                <div className="author">
                  {h.author || "Unknown author"}
                  {h.year ? ` · ${h.year}` : ""}
                </div>
              </div>
              <div className="actions">
                {readS === "Added ✓" ? (
                  <span className="added">Added ✓</span>
                ) : readS && readS !== "Adding…" ? (
                  <span className="added error-text">{readS}</span>
                ) : (
                  <button onClick={() => add(h, "read")} disabled={readS === "Adding…"}>
                    {readS === "Adding…" ? "…" : "My Books"}
                  </button>
                )}
                {read2 === "Reading ✓" ? (
                  <span className="added">Reading ✓</span>
                ) : read2 && read2 !== "Adding…" ? (
                  <span className="added error-text">{read2}</span>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => add(h, "reading")}
                    disabled={read2 === "Adding…"}
                  >
                    {read2 === "Adding…" ? "…" : "📖 Reading"}
                  </button>
                )}
                {wishS === "Saved ✓" ? (
                  <span className="added">Saved ✓</span>
                ) : wishS && wishS !== "Adding…" ? (
                  <span className="added error-text">{wishS}</span>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => add(h, "wish")}
                    disabled={wishS === "Adding…"}
                  >
                    {wishS === "Adding…" ? "…" : "♡ Wishlist"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {searched && hits.length === 0 && !error && (
        <div className="empty">
          <p>No matches for “{q}”.</p>
          <p className="muted">Add it by hand using the form below. 👇</p>
        </div>
      )}
    </section>
  );
}

function ManualPane() {
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
    setError("");
    setBusy(true);
    setDone("");
    try {
      const body = JSON.stringify({ title, author, year, coverUrl, public: isPublic });
      if (target === "read") {
        await api("/api/books/manual", { method: "POST", body });
        setDone("Added ✓ — find it in your “My Books” list.");
      } else if (target === "reading") {
        await api("/api/me/reading/manual", {
          method: "POST",
          body: JSON.stringify({ title, author, year, coverUrl }),
        });
        setDone("Now reading ✓ — find it in “Currently reading”.");
      } else {
        await api("/api/me/wishlist/manual", { method: "POST", body });
        setDone("Saved ✓ — find it in your “Wishlist”.");
      }
      setTitle("");
      setAuthor("");
      setYear("");
      setCoverUrl("");
      setIsPublic(target === "read");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="manual-section">
      <h3>Can't find your book? Add it manually</h3>

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
        <button
          type="button"
          className={target === "reading" ? "active" : ""}
          onClick={() => setTarget("reading")}
        >
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

      {done && <div className="info">{done}</div>}
      {error && <div className="error">{error}</div>}

      <form className="manual-form" onSubmit={submit}>
        <label>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Book title"
            required
          />
        </label>
        <label>
          Author
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author"
          />
        </label>
        <div className="row-fields">
          <label>
            Year
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 1987"
              inputMode="numeric"
            />
          </label>
          <label className="grow">
            Cover URL (optional)
            <input
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://…/cover.jpg"
            />
          </label>
        </div>
        {target === "reading" ? (
          <div className="muted">Currently reading is always visible to friends.</div>
        ) : (
          <div className="owned-row">
            <span className="muted">Public</span>
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              className={"switch sm" + (isPublic ? " on" : "")}
              onClick={() => setIsPublic((p) => !p)}
            >
              <span className="knob" />
            </button>
            <span className="muted">{isPublic ? "Friends can see it" : "Private"}</span>
          </div>
        )}
        <button type="submit" disabled={busy}>
          {busy
            ? "Adding…"
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
