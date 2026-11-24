import { type FormEvent, type ReactNode, useState } from "react";
import { type Category, errorMessage } from "../api";

interface BarProps {
  categories: Category[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  // Only on your own lists. The first three throw on failure so the bar can show why.
  edit?: {
    create: (name: string) => Promise<void>;
    rename: (id: number, name: string) => Promise<void>;
    remove: (id: number) => Promise<void>;
    add: (bookId: number) => void;
    // The shown list's books that aren't in the selected category.
    addable: { book_id: number; title: string }[];
  };
  // Other filters, at the end of the row.
  children?: ReactNode;
}

export function CategoryBar({ categories, selected, onSelect, edit, children }: BarProps) {
  const [mode, setMode] = useState<"new" | "rename" | "delete" | "add" | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const current = categories.find((c) => c.id === selected);

  function enter(next: typeof mode, value = "") {
    setMode(next);
    setText(value);
    setError("");
  }

  async function run(action: () => Promise<void>, next: typeof mode = null) {
    setError("");
    try {
      await action();
      enter(next);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!edit || !text.trim()) return;
    if (mode === "new") run(() => edit.create(text), "add");
    else if (current) run(() => edit.rename(current.id, text));
  }

  const query = text.trim().toLowerCase();
  const matches = edit?.addable.filter((b) => b.title.toLowerCase().includes(query)) ?? [];

  return (
    <div className="category-bar">
      <div className="filter-row">
        {(categories.length > 0 || edit) && (
          <div className="chip-picker">
            {categories.length > 0 && (
              <Chip on={selected === null} onClick={() => [enter(null), onSelect(null)]}>
                All
              </Chip>
            )}
            {categories.map((c) => (
              <Chip key={c.id} on={selected === c.id} onClick={() => [enter(null), onSelect(c.id)]}>
                {c.name}
              </Chip>
            ))}
            {edit && (
              <button type="button" className="chip" onClick={() => enter("new")}>
                + {categories.length ? "New" : "New category"}
              </button>
            )}
          </div>
        )}
        {children}
      </div>

      {edit && current && mode === null && (
        <div className="category-actions">
          {edit.addable.length > 0 && (
            <button type="button" className="link" onClick={() => enter("add")}>
              Add books
            </button>
          )}
          <button type="button" className="link" onClick={() => enter("rename", current.name)}>
            Rename
          </button>
          <button type="button" className="link danger" onClick={() => enter("delete")}>
            Delete
          </button>
        </div>
      )}
      {edit && current && mode === "delete" && (
        <div className="category-actions">
          <span className="muted">Delete “{current.name}”? Its books stay on your lists.</span>
          <button type="button" className="link danger" onClick={() => run(() => edit.remove(current.id))}>
            Delete
          </button>
          <button type="button" className="link" onClick={() => enter(null)}>
            Cancel
          </button>
        </div>
      )}
      {edit && (mode === "new" || mode === "rename") && (
        <form className="category-form" onSubmit={submit}>
          <input
            ref={(el) => el?.focus()}
            value={text}
            maxLength={50}
            placeholder="Category name"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="btn-sm" onClick={() => enter(null)}>
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-sm" disabled={!text.trim()}>
            {mode === "new" ? "Add" : "Save"}
          </button>
        </form>
      )}
      {edit && current && mode === "add" && (
        <>
          <div className="category-form">
            <input
              value={text}
              placeholder={`Add books to ${current.name}`}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="button" className="btn-sm" onClick={() => enter(null)}>
              Done
            </button>
          </div>
          <div className="chip-picker">
            {matches.map((b) => (
              <button key={b.book_id} type="button" className="chip" onClick={() => [edit.add(b.book_id), setText("")]}>
                + {b.title}
              </button>
            ))}
            {matches.length === 0 && <span className="muted">No books to add.</span>}
          </div>
        </>
      )}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`chip${on ? " picked" : ""}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

// Which categories a book is in.
export function CategoryPicker({
  categories,
  ids,
  onChange,
}: {
  categories: Category[];
  ids: number[];
  onChange: (ids: number[]) => void;
}) {
  if (categories.length === 0) return null;
  return (
    <div className="chip-picker">
      {categories.map((c) => {
        const on = ids.includes(c.id);
        return (
          <Chip key={c.id} on={on} onClick={() => onChange(on ? ids.filter((id) => id !== c.id) : [...ids, c.id])}>
            {c.name}
          </Chip>
        );
      })}
    </div>
  );
}
