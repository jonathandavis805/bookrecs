import { useState } from "react";
import { type Category, errorMessage } from "../api";

interface BarProps {
  categories: Category[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  // Only on your own profile. Each call throws on failure so the bar can show why.
  edit?: {
    create: (name: string) => Promise<void>;
    rename: (id: number, name: string) => Promise<void>;
    remove: (id: number) => Promise<void>;
  };
}

export function CategoryBar({ categories, selected, onSelect, edit }: BarProps) {
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  if (!edit && categories.length === 0) return null;
  const current = categories.find((c) => c.id === selected);

  function reset() {
    setNaming(null);
    setConfirmDelete(false);
    setError("");
  }

  function select(id: number | null) {
    reset();
    onSelect(id);
  }

  function startNaming(mode: "new" | "rename") {
    reset();
    setNaming(mode);
    setName(mode === "rename" ? (current?.name ?? "") : "");
  }

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      reset();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit || !name.trim()) return;
    run(() => (naming === "rename" && current ? edit.rename(current.id, name) : edit.create(name)));
  }

  return (
    <div className="category-bar">
      <div className="chip-picker">
        <button type="button" className={`chip${selected === null ? " picked" : ""}`} onClick={() => select(null)}>
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip${selected === c.id ? " picked" : ""}`}
            onClick={() => select(c.id)}
          >
            {c.name}
          </button>
        ))}
        {edit && (
          <button type="button" className="chip" onClick={() => startNaming("new")}>
            + New category
          </button>
        )}
      </div>
      {edit && current && !naming && (
        <div className="category-actions">
          <button type="button" className="link" onClick={() => startNaming("rename")}>
            Rename
          </button>
          {confirmDelete ? (
            <>
              <span className="small-label">Delete “{current.name}”? Its books stay on your list.</span>
              <button type="button" className="link danger" onClick={() => run(() => edit.remove(current.id))}>
                Delete
              </button>
              <button type="button" className="link" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="link danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
      )}
      {edit && naming && (
        <form className="category-form" onSubmit={submit}>
          <input
            ref={(el) => el?.focus()}
            value={name}
            maxLength={50}
            placeholder="Category name"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="button" className="btn-sm" onClick={reset}>
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-sm" disabled={!name.trim()}>
            {naming === "new" ? "Add" : "Save"}
          </button>
        </form>
      )}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

interface AdderProps {
  name: string;
  // The owner's books not yet in the category, in overall rank order.
  books: { book_id: number; title: string }[];
  onAdd: (bookId: number) => void;
  // Open straight away when the category is empty, e.g. just created.
  startOpen: boolean;
}

export function CategoryAdder({ name, books, onAdd, startOpen }: AdderProps) {
  const [open, setOpen] = useState(startOpen);
  const [query, setQuery] = useState("");
  if (books.length === 0) return null;

  if (!open) {
    return (
      <button type="button" className="link category-adder-toggle" onClick={() => setOpen(true)}>
        + Add books to {name}
      </button>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = q ? books.filter((b) => b.title.toLowerCase().includes(q)) : books;
  return (
    <div className="category-adder">
      <div className="category-form">
        <span className="small-label">Pick books to add to {name}</span>
        <input value={query} placeholder="Filter your books" onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn-sm" onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
      <div className="chip-picker">
        {matches.map((b) => (
          <button
            key={b.book_id}
            type="button"
            className="chip"
            onClick={() => {
              onAdd(b.book_id);
              setQuery("");
            }}
          >
            + {b.title}
          </button>
        ))}
        {matches.length === 0 && <span className="small-label">No matching books.</span>}
      </div>
    </div>
  );
}

interface TagsProps {
  categories: Category[];
  ids: number[];
  // Only on your own books.
  onChange?: (ids: number[]) => void;
}

export function CategoryTags({ categories, ids, onChange }: TagsProps) {
  const [open, setOpen] = useState(false);
  const assigned = categories.filter((c) => ids.includes(c.id));
  const editable = !!onChange && categories.length > 0;
  if (assigned.length === 0 && !editable) return null;

  return (
    <div className="category-tags">
      {assigned.map((c) => (
        <span key={c.id} className="badge">
          {c.name}
        </span>
      ))}
      {editable && (
        <button type="button" className="link" onClick={() => setOpen((o) => !o)}>
          {open ? "Done" : assigned.length ? "Edit categories" : "Add to category"}
        </button>
      )}
      {onChange && editable && open && (
        <div className="chip-picker">
          {categories.map((c) => {
            const on = ids.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`chip${on ? " picked" : ""}`}
                onClick={() => onChange(on ? ids.filter((id) => id !== c.id) : [...ids, c.id])}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
