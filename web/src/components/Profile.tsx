import { type ReactNode, useState } from "react";
import {
  api,
  type Book,
  type Category,
  errorMessage,
  type ListItem,
  type MineStatus,
  type NextUpItem,
  type ReadingItem,
  type User,
  type WishlistItem,
} from "../api";
import { useData } from "../useData";
import { CategoryBar, CategoryPicker } from "./Categories";
import { Byline, Cover } from "./ui/Book";
import { IconBook, IconHeadphones, IconLock } from "./ui/icons";
import { MoreButton } from "./ui/MoreButton";
import { SortableList } from "./ui/SortableList";
import { readingStatus, readStatus, StatusPicker } from "./ui/StatusPicker";
import { Switch } from "./ui/Switch";
import { Tabs } from "./ui/Tabs";

interface Props {
  username: string;
  me: User;
}

type Tab = "wish" | "read";
type Format = "all" | "read" | "listened";
type ListName = "books" | "wishlist" | "reading";

// Kept for the next visit to a profile.
let lastTab: Tab = "read";

export default function Profile({ username, me }: Props) {
  const isSelf = username.toLowerCase() === me.username.toLowerCase();
  const base = isSelf ? "/api/me" : `/api/friends/${encodeURIComponent(username)}`;
  const readData = useData<{ books: Book[]; categories?: Category[] }>(`${base}/books`);
  const wishData = useData<{ books: WishlistItem[] }>(`${base}/wishlist`);
  const readingData = useData<{ books: ReadingItem[] }>(`${base}/reading`);
  const nextUpData = useData<{ books: NextUpItem[] }>(isSelf ? "/api/me/next-up" : null);

  const [tab, setTab] = useState<Tab>(lastTab);
  const [category, setCategory] = useState<number | null>(null);
  const [format, setFormat] = useState<Format>("all");
  const [error, setError] = useState("");
  // Books moved between my lists since a friend's lists were loaded.
  const [moved, setMoved] = useState<Record<number, MineStatus>>({});
  // The row whose controls are open, and reviews typed but not saved.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const books = readData.data?.books ?? null;
  const wish = wishData.data?.books ?? null;
  const reading = readingData.data?.books ?? null;
  const nextUp = nextUpData.data?.books[0];
  const categories = readData.data?.categories ?? [];

  if (readData.error && !(isSelf && books)) {
    return (
      <div className="error">
        {isSelf ? readData.error : `You're not friends with ${username} yet. Add them in "Friends" to see their books.`}
      </div>
    );
  }
  if (!books || !wish || !reading) return <div className="loading">Loading…</div>;

  const fail = (e: unknown) => setError(errorMessage(e));
  const post = (path: string, body: object, method = "POST") => api(path, { method, body: JSON.stringify(body) });

  const reloadMine = () =>
    Promise.all([readData.reload(), wishData.reload(), readingData.reload(), nextUpData.reload()]);

  // Anything that moves a book between lists.
  async function move(path: string, body: object = {}, method = "POST") {
    setError("");
    try {
      await post(`/api/me/${path}`, body, method);
      await reloadMine();
    } catch (e) {
      fail(e);
    }
  }

  const remove = (list: ListName, bookId: number) => move(`${list}/${bookId}`, {}, "DELETE");

  function setPublic(list: "books" | "wishlist", bookId: number, next: boolean) {
    const change = <T extends Book | WishlistItem>(b: T) => (b.book_id === bookId ? { ...b, public: next ? 1 : 0 } : b);
    if (list === "books") readData.update((d) => ({ ...d, books: d.books.map(change) }));
    else wishData.update((d) => ({ books: d.books.map(change) }));
    post(`/api/me/${list}/${bookId}/public`, { public: next }).catch(fail);
  }

  function setOwned(bookId: number, owned: boolean) {
    wishData.update((d) => ({
      books: d.books.map((b) => (b.book_id === bookId ? { ...b, owned: owned ? 1 : 0 } : b)),
    }));
    post(`/api/me/wishlist/${bookId}/owned`, { owned }).catch(fail);
  }

  async function saveReview(bookId: number, review: string) {
    setError("");
    try {
      await post(`/api/me/books/${bookId}`, { review }, "PATCH");
      readData.update((d) => ({ ...d, books: d.books.map((b) => (b.book_id === bookId ? { ...b, review } : b)) }));
      setDrafts(({ [bookId]: _, ...rest }) => rest);
    } catch (e) {
      fail(e);
    }
  }

  // Categories belong to the book, so a change shows on every list it's on.
  function mapCategories(change: (bookId: number, ids: number[]) => number[]) {
    const apply = <T extends ListItem>(b: T) => ({ ...b, category_ids: change(b.book_id, b.category_ids) });
    readData.update((d) => ({ ...d, books: d.books.map(apply) }));
    wishData.update((d) => ({ books: d.books.map(apply) }));
    readingData.update((d) => ({ books: d.books.map(apply) }));
  }

  function setBookCategories(bookId: number, ids: number[]) {
    mapCategories((id, current) => (id === bookId ? ids : current));
    post(`/api/me/books/${bookId}/categories`, { category_ids: ids }).catch(fail);
  }

  const setCategories = (next: Category[]) => readData.update((d) => ({ ...d, categories: next }));
  const categoryEdit = {
    create: async (name: string) => {
      const d = (await post("/api/me/categories", { name })) as { category: Category; categories: Category[] };
      setCategories(d.categories);
      setCategory(d.category.id);
    },
    rename: async (id: number, name: string) => {
      const d = (await post(`/api/me/categories/${id}`, { name }, "PATCH")) as { categories: Category[] };
      setCategories(d.categories);
    },
    remove: async (id: number) => {
      const d = (await post(`/api/me/categories/${id}`, {}, "DELETE")) as { categories: Category[] };
      setCategories(d.categories);
      setCategory(null);
      mapCategories((_, ids) => ids.filter((c) => c !== id));
    },
  };

  const inCategory = (b: ListItem) => category === null || b.category_ids.includes(category);
  const inFormat = (b: Book) => format === "all" || !!b.listened === (format === "listened");
  const shownRead = books.filter((b) => inCategory(b) && inFormat(b));
  const shownWish = wish.filter(inCategory);
  const filtered = category !== null || (tab === "read" && format !== "all");
  const list: ListItem[] = tab === "read" ? books : wish;

  // A filtered list swaps among the overall slots its books hold.
  function merged<T extends ListItem>(all: T[], order: T[]): T[] {
    const members = new Set(order.map((b) => b.book_id));
    let next = 0;
    return all.map((b) => (members.has(b.book_id) ? order[next++] : b));
  }

  function reorderRead(order: Book[]) {
    if (!books) return;
    const all = merged(books, order);
    readData.update((d) => ({ ...d, books: all }));
    post("/api/me/books/reorder", { ordered: all.map((b) => b.book_id) }).catch(fail);
  }

  function reorderWish(order: WishlistItem[]) {
    if (!wish) return;
    const all = merged(wish, order);
    wishData.update(() => ({ books: all }));
    post("/api/me/wishlist/reorder", { ordered: all.map((b) => b.book_id) }).catch(fail);
  }

  // What's worth knowing about a book at a glance; the usual (public, read) goes unsaid.
  function marks(b: ListItem, { audio, secret, owned }: { audio?: number; secret?: boolean; owned?: number } = {}) {
    return (
      <div className="marks">
        {filtered && list.includes(b) && <span>#{list.indexOf(b) + 1} overall</span>}
        {categories
          .filter((c) => b.category_ids.includes(c.id))
          .map((c) => (
            <span key={c.id} className="tag">
              {c.name}
            </span>
          ))}
        {!!owned && <span>Owned</span>}
        {!!audio && (
          <span title="Audiobook">
            <IconHeadphones size={14} />
          </span>
        )}
        {secret && (
          <span title="Private">
            <IconLock size={14} />
          </span>
        )}
      </div>
    );
  }

  // The options button for one of my books and, when open, its controls.
  function options(
    listName: ListName,
    b: ListItem,
    status: MineStatus,
    extra?: { switches?: ReactNode; review?: string | null },
  ) {
    const row = `${listName}-${b.book_id}`;
    const open = openRow === row;
    const draft = drafts[b.book_id] ?? extra?.review ?? "";
    return (
      <>
        <MoreButton title={b.title} open={open} onToggle={() => setOpenRow(open ? null : row)} />
        {open && (
          <div className="row-panel">
            <div className="row-panel-line">
              <StatusPicker status={status} book={{ book_id: b.book_id }} onChange={() => reloadMine()} />
              {extra?.switches}
              <button type="button" className="link danger" onClick={() => remove(listName, b.book_id)}>
                Remove
              </button>
            </div>
            <CategoryPicker
              categories={categories}
              ids={b.category_ids}
              onChange={(ids) => setBookCategories(b.book_id, ids)}
            />
            {extra && "review" in extra && (
              <>
                <textarea
                  className="review"
                  aria-label="Review"
                  value={draft}
                  placeholder="Write a review…"
                  onChange={(e) => setDrafts((d) => ({ ...d, [b.book_id]: e.target.value }))}
                />
                {draft !== (extra.review ?? "") && (
                  <button type="button" className="btn-primary btn-sm" onClick={() => saveReview(b.book_id, draft)}>
                    Save review
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </>
    );
  }

  const publicSwitch = (listName: "books" | "wishlist", b: Book | WishlistItem) => (
    // biome-ignore lint/a11y/noLabelWithoutControl: the switch is the control
    <label className="toggle">
      <Switch checked={!!b.public} onChange={(next) => setPublic(listName, b.book_id, next)} />
      Public
    </label>
  );

  // My status on a friend's book.
  const picker = (b: ListItem) => (
    <div className="actions">
      <StatusPicker
        status={moved[b.book_id] ?? b.mine}
        book={{ book_id: b.book_id }}
        onChange={(next) => setMoved((m) => ({ ...m, [b.book_id]: next }))}
      />
    </div>
  );

  const alreadyRead = (b: ListItem) => books.some((r) => r.book_id === b.book_id);
  const rereading = (b: ListItem) => reading.find((r) => r.book_id === b.book_id);
  const empty =
    list.length > 0
      ? "No books match this filter."
      : tab === "read"
        ? isSelf
          ? "No books yet."
          : "No public books yet."
        : isSelf
          ? "Nothing on your wishlist yet."
          : "No public wishlist books yet.";

  return (
    <div className="page">
      {!isSelf && <h2 className="page-title">{username}</h2>}
      {error && <div className="error">{error}</div>}

      {(reading.length > 0 || nextUp || isSelf) && (
        <section>
          <h3 className="section-title">Reading</h3>
          {reading.length === 0 && !nextUp && <p className="muted">Nothing right now.</p>}
          {(reading.length > 0 || nextUp) && (
            <ul className="book-list">
              {reading.map((b) => (
                <li key={b.book_id} className="book-row">
                  <BookSummary book={b} />
                  {marks(b, { audio: b.listening })}
                  {isSelf ? (
                    <>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => move("status", { book_id: b.book_id, status: "read" })}
                      >
                        Finish
                      </button>
                      {options("reading", b, readingStatus(b.listening, alreadyRead(b)))}
                    </>
                  ) : (
                    picker(b)
                  )}
                </li>
              ))}
              {nextUp && (
                <li className="book-row next-up">
                  <BookSummary book={nextUp}>
                    <div className="author">
                      Next up ·{" "}
                      {nextUp.owned
                        ? "you own this"
                        : nextUp.friendUsername
                          ? `${nextUp.friendUsername} has read it`
                          : "top of your wishlist"}
                    </div>
                  </BookSummary>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => move("reading/from-wishlist", { book_id: nextUp.book_id })}
                  >
                    Start
                  </button>
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      <section>
        <Tabs
          tabs={[
            { id: "wish", label: "Wishlist", count: wish.length },
            { id: "read", label: "Read", count: books.length },
          ]}
          selected={tab}
          onSelect={(next) => {
            lastTab = next;
            setTab(next);
            setOpenRow(null);
          }}
        />

        {list.length > 0 && (
          <CategoryBar
            categories={categories}
            selected={category}
            onSelect={setCategory}
            edit={
              isSelf
                ? {
                    ...categoryEdit,
                    addable: list.filter((b) => category !== null && !b.category_ids.includes(category)),
                    add: (bookId) => {
                      const ids = list.find((b) => b.book_id === bookId)?.category_ids ?? [];
                      if (category !== null) setBookCategories(bookId, [...ids, category]);
                    },
                  }
                : undefined
            }
          >
            {tab === "read" && books.some((b) => b.listened) && <FormatFilter format={format} onChange={setFormat} />}
          </CategoryBar>
        )}

        {(tab === "read" ? shownRead : shownWish).length === 0 ? (
          <div className="empty">
            {empty}{" "}
            {isSelf && list.length === 0 && (
              <a href="#/add" className="text-link">
                Add a book
              </a>
            )}
          </div>
        ) : tab === "read" ? (
          isSelf ? (
            <SortableList items={shownRead} itemKey={(b) => b.book_id} onReorder={reorderRead}>
              {(b) => {
                const again = rereading(b);
                return (
                  <>
                    <BookSummary book={b}>{b.review && <div className="excerpt">{b.review}</div>}</BookSummary>
                    {marks(b, { audio: b.listened, secret: !b.public })}
                    {options("books", b, again ? readingStatus(again.listening, true) : readStatus(b.listened), {
                      switches: publicSwitch("books", b),
                      review: b.review,
                    })}
                  </>
                );
              }}
            </SortableList>
          ) : (
            <ul className="book-list">
              {shownRead.map((b, i) => (
                <li key={b.book_id} className="book-row">
                  <span className="rank">{i + 1}</span>
                  <BookSummary book={b}>{b.review && <div className="review-text">{b.review}</div>}</BookSummary>
                  {marks(b, { audio: b.listened })}
                  {picker(b)}
                </li>
              ))}
            </ul>
          )
        ) : isSelf ? (
          <SortableList items={shownWish} itemKey={(b) => b.book_id} onReorder={reorderWish}>
            {(b) => (
              <>
                <BookSummary book={b} />
                {marks(b, { owned: b.owned, secret: !b.public })}
                {options("wishlist", b, "wish", {
                  switches: (
                    <>
                      {/* biome-ignore lint/a11y/noLabelWithoutControl: the switch is the control */}
                      <label className="toggle">
                        <Switch checked={!!b.owned} onChange={(next) => setOwned(b.book_id, next)} />
                        Owned
                      </label>
                      {publicSwitch("wishlist", b)}
                    </>
                  ),
                })}
              </>
            )}
          </SortableList>
        ) : (
          <ul className="book-list">
            {shownWish.map((b) => (
              <li key={b.book_id} className="book-row">
                <BookSummary book={b} />
                {marks(b, { owned: b.owned })}
                {picker(b)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FormatFilter({ format, onChange }: { format: Format; onChange: (next: Format) => void }) {
  const options = [
    ["read", "Read only", IconBook],
    ["listened", "Listened only", IconHeadphones],
  ] as const;
  return (
    <div className="chip-picker format-filter">
      {options.map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          className={`chip${format === value ? " picked" : ""}`}
          aria-pressed={format === value}
          aria-label={label}
          title={label}
          onClick={() => onChange(format === value ? "all" : value)}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

function BookSummary({ book, children }: { book: ListItem; children?: ReactNode }) {
  return (
    <>
      <Cover url={book.cover_url} />
      <div className="info">
        <a href={`#/book/${book.book_id}`} className="title book-title-link">
          {book.title}
        </a>
        <Byline author={book.author} year={book.first_publish_year} />
        {children}
      </div>
    </>
  );
}
