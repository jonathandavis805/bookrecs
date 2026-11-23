import { useState } from "react";
import { api, errorMessage, type MineStatus } from "../../api";
import { IconBook, IconCheck, IconHeart } from "./icons";
import { Tooltip } from "./Tooltip";

export type Status = "reading" | "wish" | "read";

const OPTIONS = [
  { value: "reading", label: "Reading", Icon: IconBook },
  { value: "wish", label: "Wishlist", Icon: IconHeart },
  { value: "read", label: "Read", Icon: IconCheck },
] as const;

// What picking each option does, by the book's current status.
const ACTIONS: Record<Exclude<MineStatus, null> | "none", Record<Status, string>> = {
  none: { reading: "Start reading", wish: "Add to wishlist", read: "Mark as read" },
  wish: { reading: "Start reading", wish: "On your wishlist", read: "Mark as read" },
  reading: { reading: "Reading now", wish: "Move to wishlist", read: "Mark as finished" },
  rereading: { reading: "Rereading now", wish: "Already read", read: "Finish rereading" },
  read: { reading: "Read again", wish: "Already read", read: "Already read" },
};

// Only the chosen option spells out its label unless `labelled`. Rereading lights
// Read as well, which then finishes the reread.
export function StatusChoice({
  value,
  onChange,
  labelled = false,
  disabled = [],
  hints,
}: {
  value: MineStatus;
  onChange: (next: Status) => void;
  labelled?: boolean;
  disabled?: Status[];
  hints?: Record<Status, string>;
}) {
  return (
    <div className="segmented compact status-picker">
      {OPTIONS.map(({ value: option, label, Icon }) => {
        const rereading = value === "rereading";
        const current = option === (rereading ? "reading" : value);
        const active = current || (rereading && option === "read");
        const text = rereading && current ? "Rereading" : label;
        return (
          <Tooltip key={option} label={hints?.[option]}>
            <button
              type="button"
              className={active ? "active" : ""}
              aria-label={current ? text : (hints?.[option] ?? label)}
              aria-pressed={active}
              disabled={disabled.includes(option)}
              onClick={() => !current && onChange(option)}
            >
              <Icon />
              {(current || labelled) && text}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

// Shows which of the viewer's lists a book is on, and moves it between them.
export function StatusPicker({
  status,
  book,
  atLimit = false,
  onChange,
}: {
  status: MineStatus | undefined;
  book: { book_id: number } | { ol_key: string; year?: number };
  atLimit?: boolean;
  onChange: (next: MineStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(next: Status) {
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify({ ...book, status: next });
      const { mine } = await api<{ mine: MineStatus }>("/api/me/status", { method: "POST", body });
      onChange(mine);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled: Status[] = busy ? ["reading", "wish", "read"] : [];
  // The server keeps books you've read off the wishlist.
  if (status === "read" || status === "rereading") disabled.push("wish");
  const hints = { ...ACTIONS[status ?? "none"] };
  if (atLimit && !status) {
    disabled.push("read");
    hints.read = "Book limit reached";
  }

  return (
    <>
      {error && <span className="error-text">{error}</span>}
      <StatusChoice value={status ?? null} onChange={pick} disabled={disabled} hints={hints} />
    </>
  );
}
