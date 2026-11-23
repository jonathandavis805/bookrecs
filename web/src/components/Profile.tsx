import { Reorder, useDragControls } from "framer-motion";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from "react";
import {
  api,
  type Book,
  type Category,
  errorMessage,
  type ListItem,
  type NextUpItem,
  type ReadingItem,
  type User,
  type WishlistItem,
} from "../api";
import { CategoryAdder, CategoryBar, CategoryTags } from "./Categories";
import { Byline, Cover } from "./ui/Book";
import { IconBook, IconChevronDown, IconGrip, IconHeart, IconUndo, IconX } from "./ui/icons";
import { Switch } from "./ui/Switch";

interface Props {
  username: string;
  me: User;
}

type Mine = "read" | "wish" | "reading" | null;
type ListName = "books" | "wishlist" | "reading";
type Format = "all" | "read" | "listened";

export default function Profile({ username, me }: Props) {
  const isSelf = username.toLowerCase() === me.username.toLowerCase();

  const [books, setBooks] = useState<Book[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  // One filter for books read and the wishlist, and which list's bar last set it.
  const [category, setCategory] = useState<number | null>(null);
  const [filterFrom, setFilterFrom] = useState<"read" | "wish">("read");
  const [format, setFormat] = useState<Format>("all");
  const [wish, setWish] = useState<WishlistItem[] | null>(null);
  const [reading, setReading] = useState<ReadingItem[] | null>(null);
  const [nextUp, setNextUp] = useState<NextUpItem | null>(null);
  const [readError, setReadError] = useState("");
  const [wishStatus, setWishStatus] = useState<Record<number, string>>({});

  // Edit state for self
  const [reviews, setReviews] = useState<Record<number, string>>({});
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setBooks(null);
    setCategories([]);
    setCategory(null);
    setFormat("all");
    setWish(null);
    setReading(null);
    setNextUp(null);
    setReadError("");

    const readPath = isSelf ? "/api/me/books" : `/api/friends/${encodeURIComponent(username)}/books`;
    api<{ books: Book[]; categories?: Category[] }>(readPath)
      .then((d) => {
        if (!cancelled) {
          setBooks(d.books);
          setCategories(d.categories ?? []);
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
      api<{ books: Book[]; categories: Category[] }>("/api/me/books"),
      api<{ books: WishlistItem[] }>("/api/me/wishlist"),
      api<{ books: ReadingItem[] }>("/api/me/reading"),
      api<{ books: NextUpItem[] }>("/api/me/next-up"),
    ]);
    setBooks(r.books);
    setCategories(r.categories);
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

  // `flag` is both the book's field and the route that sets it.
  async function setFlag<T extends ListItem>(
    list: ListName,
    setList: Dispatch<SetStateAction<T[] | null>>,
    bookId: number,
    flag: keyof T & string,
    next: boolean,
  ) {
    setList((l) => l?.map((x) => (x.book_id === bookId ? { ...x, [flag]: next ? 1 : 0 } : x)) ?? null);
    try {
      await api(`/api/me/${list}/${bookId}/${flag}`, { method: "POST", body: JSON.stringify({ [flag]: next }) });
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  async function move(path: string, method: "POST" | "DELETE" = "POST", body: object = {}) {
    try {
      await api(`/api/me/${path}`, { method, body: JSON.stringify(body) });
      await reloadMine();
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  const remove = (list: ListName, bookId: number) => move(`${list}/${bookId}`, "DELETE");

  // When filtered, newOrder is just the shown books: they swap among the overall
  // slots they hold. The category route does the same server side; with a
  // format filter the whole resulting order is sent instead.
  function handleReadReorder(newOrder: Book[]) {
    const fail = (e: unknown) => setReadError(errorMessage(e));
    if (category === null && format === "all") {
      setBooks(newOrder);
      const ordered = JSON.stringify({ ordered: newOrder.map((b) => b.book_id) });
      api("/api/me/books/reorder", { method: "POST", body: ordered }).catch(fail);
      return;
    }
    if (!books) return;
    const members = new Set(newOrder.map((b) => b.book_id));
    let next = 0;
    const all = books.map((b) => (members.has(b.book_id) ? newOrder[next++] : b));
    setBooks(all);
    const [path, ids] =
      format === "all" ? [`/api/me/categories/${category}/reorder`, newOrder] : ["/api/me/books/reorder", all];
    api(path, { method: "POST", body: JSON.stringify({ ordered: ids.map((b) => b.book_id) }) }).catch(fail);
  }

  // Categories belong to the book, so a change shows on every list it's on.
  function mapCategories(change: (bookId: number, ids: number[]) => number[]) {
    const apply = <T extends { book_id: number; category_ids: number[] }>(list: T[] | null) =>
      list ? list.map((x) => ({ ...x, category_ids: change(x.book_id, x.category_ids) })) : null;
    setBooks(apply);
    setWish(apply);
    setReading(apply);
  }

  async function setBookCategories(bookId: number, ids: number[]) {
    mapCategories((id, current) => (id === bookId ? ids : current));
    try {
      await api(`/api/me/books/${bookId}/categories`, { method: "POST", body: JSON.stringify({ category_ids: ids }) });
    } catch (e) {
      setReadError(errorMessage(e));
    }
  }

  const categoryEdit = {
    create: async (name: string) => {
      const d = await api<{ category: Category; categories: Category[] }>("/api/me/categories", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setCategories(d.categories);
      setCategory(d.category.id);
    },
    rename: async (id: number, name: string) => {
      const d = await api<{ categories: Category[] }>(`/api/me/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setCategories(d.categories);
    },
    remove: async (id: number) => {
      const d = await api<{ categories: Category[] }>(`/api/me/categories/${id}`, { method: "DELETE" });
      setCategories(d.categories);
      setCategory(null);
      mapCategories((_, ids) => ids.filter((c) => c !== id));
    },
  };

  const shown =
    books?.filter(
      (b) =>
        (category === null || b.category_ids.includes(category)) &&
        (format === "all" || !!b.listened === (format === "listened")),
    ) ?? null;
  // Only shown when filtered, where position in the list differs from overall.
  const overall = (b: Book) => ((category !== null || format !== "all") && books ? books.indexOf(b) + 1 : undefined);

  const shownWish = wish?.filter((b) => category === null || b.category_ids.includes(category)) ?? null;
  const overallWish = (b: WishlistItem) => (category !== null && wish ? wish.indexOf(b) + 1 : undefined);
  const categoryName = categories.find((c) => c.id === category)?.name ?? "";
  const categoryEmpty = ![...(books ?? []), ...(wish ?? [])].some((b) => b.category_ids.includes(category ?? 0));

  // As with reads, a filtered list swaps among the slots its books hold.
  function handleWishReorder(newOrder: WishlistItem[]) {
    if (!wish) return;
    const members = new Set(newOrder.map((b) => b.book_id));
    let next = 0;
    const all = wish.map((b) => (members.has(b.book_id) ? newOrder[next++] : b));
    setWish(all);
    api("/api/me/wishlist/reorder", {
      method: "POST",
      body: JSON.stringify({ ordered: all.map((b) => b.book_id) }),
    }).catch((e) => setReadError(errorMessage(e)));
  }

  function categoryFilter(
    from: "read" | "wish",
    list: { book_id: number; title: string; category_ids: number[] }[] | null,
  ) {
    if (!list?.length) return null;
    const create = async (name: string) => {
      setFilterFrom(from);
      await categoryEdit.create(name);
    };
    return (
      <>
        <CategoryBar
          categories={categories}
          selected={category}
          onSelect={(id) => {
            setFilterFrom(from);
            setCategory(id);
          }}
          edit={isSelf ? { ...categoryEdit, create } : undefined}
        />
        {isSelf && category !== null && (
          <CategoryAdder
            key={category}
            name={categoryName}
            books={list.filter((b) => !b.category_ids.includes(category))}
            onAdd={(bookId) => {
              const ids = list.find((b) => b.book_id === bookId)?.category_ids ?? [];
              setBookCategories(bookId, [...ids, category]);
            }}
            startOpen={categoryEmpty && filterFrom === from}
          />
        )}
      </>
    );
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

  function actions(bookId: number, mine: Mine | undefined) {
    if (isSelf) return null;

    if (mine === "reading") {
      return <span className="muted">In your reading</span>;
    }

    const w = wishStatus[bookId];

    let wishBtn: ReactNode;
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

    return wishBtn;
  }

  return (
    <div className="page">
      {readError && (
        <div className="error">
          {isSelf ? readError : `You're not friends with ${username} yet. Add them in "Friends" to see their books.`}
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
                ? 'Nothing here. Open a book and pick "Start reading" to track what you\'re on.'
                : `${username} isn't reading anything right now.`}
            </div>
          ) : (
            <ul className="book-list">
              {reading.map((b) => (
                <li key={b.book_id} className="book-row">
                  <BookSummary
                    book={b}
                    badge={!isSelf && b.listening ? <span className="badge">Listening</span> : null}
                    categories={categories}
                    onSetCategories={isSelf ? (ids) => setBookCategories(b.book_id, ids) : undefined}
                  >
                    {isSelf && (
                      <div className="toggle-row">
                        <FormatPicker
                          listened={!!b.listening}
                          labels={["Reading", "Listening"]}
                          onChange={(next) => setFlag("reading", setReading, b.book_id, "listening", next)}
                        />
                      </div>
                    )}
                  </BookSummary>
                  {isSelf ? (
                    <div className="actions">
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => move(`reading/${b.book_id}/finish`)}
                        title="Finished — move to Books read"
                      >
                        Finished
                      </button>
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => move(`reading/${b.book_id}/back-to-wishlist`)}
                        title="Back to wishlist"
                      >
                        <IconUndo /> Wishlist
                      </button>
                      <RemoveButton onClick={() => remove("reading", b.book_id)} />
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
                  <BookSummary book={nextUp}>
                    <div className="author">
                      {nextUp.reason === "owned"
                        ? `You own this · #${nextUp.rank} on wishlist`
                        : `${nextUp.friendUsername} has this · #${nextUp.rank} on wishlist`}
                    </div>
                  </BookSummary>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => move("reading/from-wishlist", "POST", { book_id: nextUp.book_id })}
                    >
                      <IconBook /> Start reading
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
          {books?.some((b) => b.listened) && (
            <div className="chip-picker format-filter">
              {(["all", "read", "listened"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`chip${format === f ? " picked" : ""}`}
                  onClick={() => setFormat(f)}
                >
                  {f === "all" ? "Read and listened" : f === "read" ? "Read" : "Listened"}
                </button>
              ))}
            </div>
          )}
          {categoryFilter("read", books)}
          {books === null || shown === null ? (
            <div className="loading">Loading…</div>
          ) : books.length === 0 ? (
            <div className="empty muted">
              {isSelf ? 'No books yet. Add some from the "Add Book" page.' : "No public books yet."}
            </div>
          ) : shown.length === 0 ? (
            <div className="empty muted">
              {format === "all" ? "No books in this category yet." : "No books match this filter."}
            </div>
          ) : isSelf ? (
            <Reorder.Group axis="y" values={shown} onReorder={handleReadReorder} className="book-list">
              {shown.map((b, i) => (
                <ReadItem
                  key={b.book_id}
                  book={b}
                  rank={i + 1}
                  overall={overall(b)}
                  categories={categories}
                  onSetCategories={(ids) => setBookCategories(b.book_id, ids)}
                  review={reviews[b.book_id] ?? ""}
                  dirty={!!dirty[b.book_id]}
                  saving={!!saving[b.book_id]}
                  reviewOnChange={(v) => {
                    setReviews((r) => ({ ...r, [b.book_id]: v }));
                    setDirty((d) => ({ ...d, [b.book_id]: true }));
                  }}
                  onSaveReview={() => saveReview(b.book_id)}
                  onTogglePublic={(next) => setFlag("books", setBooks, b.book_id, "public", next)}
                  onSetListened={(next) => setFlag("books", setBooks, b.book_id, "listened", next)}
                  onRemove={() => remove("books", b.book_id)}
                />
              ))}
            </Reorder.Group>
          ) : (
            <ol className="book-list">
              {shown.map((b, i) => (
                <li key={b.book_id} className="book-row">
                  <span className="rank">#{i + 1}</span>
                  <BookSummary
                    book={b}
                    badge={b.listened ? <span className="badge">Listened</span> : null}
                    overall={overall(b)}
                    categories={categories}
                  >
                    {b.review && <div className="review-text">{b.review}</div>}
                  </BookSummary>
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
          {categoryFilter("wish", wish)}
          {wish === null || shownWish === null ? (
            <div className="loading">Loading…</div>
          ) : wish.length === 0 ? (
            <div className="empty">
              <p className="muted">
                {isSelf
                  ? 'Nothing here yet. Add a friend\'s book, or search and pick "Wishlist".'
                  : `${username} has no public wishlist items yet.`}
              </p>
            </div>
          ) : shownWish.length === 0 ? (
            <div className="empty muted">No wishlist books in this category yet.</div>
          ) : isSelf ? (
            <Reorder.Group axis="y" values={shownWish} onReorder={handleWishReorder} className="book-list">
              {shownWish.map((b, i) => (
                <WishItem
                  key={b.book_id}
                  item={b}
                  rank={i + 1}
                  overall={overallWish(b)}
                  categories={categories}
                  onSetCategories={(ids) => setBookCategories(b.book_id, ids)}
                  onSetOwned={(next) => setFlag("wishlist", setWish, b.book_id, "owned", next)}
                  onTogglePublic={(next) => setFlag("wishlist", setWish, b.book_id, "public", next)}
                  onRemove={() => remove("wishlist", b.book_id)}
                />
              ))}
            </Reorder.Group>
          ) : (
            <ul className="book-list">
              {shownWish.map((b) => (
                <li key={b.book_id} className="book-row">
                  <BookSummary book={b} categories={categories}>
                    {b.owned ? <div className="author">Owned</div> : null}
                  </BookSummary>
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

function FormatPicker({
  listened,
  labels,
  onChange,
}: {
  listened: boolean;
  labels: [read: string, listened: string];
  onChange: (listened: boolean) => void;
}) {
  return (
    <div className="segmented compact">
      {[false, true].map((value) => (
        <button
          key={String(value)}
          type="button"
          className={listened === value ? "active" : ""}
          aria-pressed={listened === value}
          onClick={() => onChange(value)}
        >
          {labels[value ? 1 : 0]}
        </button>
      ))}
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn remove" onClick={onClick} title="Remove" aria-label="Remove">
      <IconX />
    </button>
  );
}

function BookSummary({
  book,
  badge,
  overall,
  categories = [],
  onSetCategories,
  children,
}: {
  book: ListItem;
  badge?: ReactNode;
  overall?: number;
  categories?: Category[];
  onSetCategories?: (ids: number[]) => void;
  children?: ReactNode;
}) {
  return (
    <>
      <Cover url={book.cover_url} />
      <div className="info">
        <div className="title">
          <a href={`#/book/${book.book_id}`} className="book-title-link">
            {book.title}
          </a>
          {book.manual ? <span className="badge">manual</span> : null}
          {badge}
        </div>
        <Byline author={book.author} year={book.first_publish_year} />
        {overall ? <div className="small-label">#{overall} overall</div> : null}
        <CategoryTags categories={categories} ids={book.category_ids} onChange={onSetCategories} />
        {children}
      </div>
    </>
  );
}

function SortableRow({
  item,
  rank,
  className = "",
  children,
}: {
  item: ListItem;
  rank: number;
  className?: string;
  children: ReactNode;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={item}
      as="li"
      dragListener={false}
      dragControls={controls}
      className={`book-row ${className}`}
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
      <span className="rank">#{rank}</span>
      {children}
    </Reorder.Item>
  );
}

function ReadItem({
  book,
  rank,
  overall,
  categories,
  onSetCategories,
  review,
  dirty,
  saving,
  reviewOnChange,
  onSaveReview,
  onTogglePublic,
  onSetListened,
  onRemove,
}: {
  book: Book;
  rank: number;
  overall?: number;
  categories: Category[];
  onSetCategories: (ids: number[]) => void;
  review: string;
  dirty: boolean;
  saving: boolean;
  reviewOnChange: (v: string) => void;
  onSaveReview: () => void;
  onTogglePublic: (next: boolean) => void;
  onSetListened: (next: boolean) => void;
  onRemove: () => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);

  return (
    <SortableRow item={book} rank={rank} className="read-row">
      <BookSummary
        book={book}
        badge={book.isReading ? <span className="badge accent">Reading</span> : null}
        overall={overall}
        categories={categories}
        onSetCategories={onSetCategories}
      >
        <div className="review-row">
          <button
            type="button"
            className={`review-toggle${reviewOpen ? " open" : ""}`}
            onClick={() => setReviewOpen((o) => !o)}
          >
            {reviewOpen ? "Hide review" : review.trim() ? "Edit review" : "Add review"}
            <IconChevronDown size={12} />
          </button>
          <FormatPicker listened={!!book.listened} labels={["Read", "Listened"]} onChange={onSetListened} />
        </div>
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
      </BookSummary>
      <div className="actions">
        <div className="public-col">
          <Switch checked={!!book.public} onChange={onTogglePublic} title="Visible to friends" />
          <span className="small-label">{book.public ? "Public" : "Private"}</span>
        </div>
        <RemoveButton onClick={onRemove} />
      </div>
    </SortableRow>
  );
}

function WishItem({
  item,
  rank,
  overall,
  categories,
  onSetCategories,
  onSetOwned,
  onTogglePublic,
  onRemove,
}: {
  item: WishlistItem;
  rank: number;
  overall?: number;
  categories: Category[];
  onSetCategories: (ids: number[]) => void;
  onSetOwned: (next: boolean) => void;
  onTogglePublic: (next: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <SortableRow item={item} rank={rank}>
      <BookSummary book={item} overall={overall} categories={categories} onSetCategories={onSetCategories}>
        <div className="toggle-row">
          <span className="muted">Owned</span>
          <Switch checked={!!item.owned} onChange={onSetOwned} title="Mark as owned" />
          <span className="muted">Public</span>
          <Switch checked={!!item.public} onChange={onTogglePublic} title="Visible to friends" />
        </div>
      </BookSummary>
      <RemoveButton onClick={onRemove} />
    </SortableRow>
  );
}
