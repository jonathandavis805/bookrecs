import { useState } from "react";
import { api, errorMessage, type MineStatus } from "../../api";
import { IconBook, IconCheck, IconHeadphones, IconHeart, IconSwap } from "./icons";
import { Tooltip } from "./Tooltip";

export type Status = "reading" | "wish" | "read";
// The formats a book on a list can switch to.
type Pick = Status | "listening" | "listened";

const OPTIONS = [
  { value: "reading", label: "Reading", Icon: IconBook },
  { value: "wish", label: "Wishlist", Icon: IconHeart },
  { value: "read", label: "Read", Icon: IconCheck },
] as const;

// Which option each status lights, and how it words it. Rereading lights Read as
// well, which then finishes the reread.
const STATUSES: Record<
  Exclude<MineStatus, null>,
  { on: Status; label: string; audio?: boolean; again?: boolean; swap?: Pick }
> = {
  wish: { on: "wish", label: "Wishlist" },
  reading: { on: "reading", label: "Reading", swap: "listening" },
  listening: { on: "reading", label: "Listening", audio: true, swap: "reading" },
  rereading: { on: "reading", label: "Rereading", again: true, swap: "listening" },
  relistening: { on: "reading", label: "Relistening", audio: true, again: true, swap: "reading" },
  read: { on: "read", label: "Read", swap: "listened" },
  listened: { on: "read", label: "Listened", audio: true, swap: "read" },
};

export const statusLabel = (status: Exclude<MineStatus, null>) => STATUSES[status].label;

export const readStatus = (listened: number): MineStatus => (listened ? "listened" : "read");

export function readingStatus(listening: number, alsoRead: boolean): MineStatus {
  if (alsoRead) return listening ? "relistening" : "rereading";
  return listening ? "listening" : "reading";
}

// What picking an option other than the lit one does.
function moveHint(option: Status, status: MineStatus): string {
  const { on, label, again } = status ? STATUSES[status] : {};
  if (option === "reading") return on === "read" ? "Read again" : "Start reading";
  if (option === "wish") return on === "read" || again ? "Already read" : on ? "Move to wishlist" : "Add to wishlist";
  if (again) return `Finish ${label?.toLowerCase()}`;
  return on === "reading" ? "Mark as finished" : "Mark as read";
}

const SWAP_HINTS: Partial<Record<Pick, string>> = {
  reading: "Switch to reading",
  listening: "Switch to listening",
  read: "Switch to read",
  listened: "Switch to listened",
};

// A plain choice of list, for a book that isn't on one yet.
export function StatusChoice({ value, onChange }: { value: Status; onChange: (next: Status) => void }) {
  return (
    <div className="segmented compact status-picker">
      {OPTIONS.map(({ value: option, label, Icon }) => (
        <button
          key={option}
          type="button"
          className={option === value ? "active" : ""}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          <Icon />
          {label}
        </button>
      ))}
    </div>
  );
}

// Shows which of the viewer's lists a book is on, and moves it between them.
// The lit option switches between reading and listening.
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

  async function pick(next: Pick) {
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

  const shown = status ? STATUSES[status] : null;

  return (
    <>
      {error && <span className="error-text">{error}</span>}
      <div className="segmented compact status-picker">
        {OPTIONS.map(({ value: option, Icon }) => {
          const current = shown?.on === option;
          const limited = atLimit && !shown && option === "read";
          // The server keeps books you've read off the wishlist.
          const alreadyRead = option === "wish" && (shown?.on === "read" || shown?.again);
          const swap = current ? shown.swap : undefined;
          const hint = current
            ? swap
              ? SWAP_HINTS[swap]
              : "On your wishlist"
            : limited
              ? "Book limit reached"
              : moveHint(option, status ?? null);
          const OptionIcon = current && shown.audio ? IconHeadphones : Icon;
          const lit = current || (shown?.again && option === "read");
          return (
            <Tooltip key={option} label={hint}>
              <button
                type="button"
                className={lit ? "active" : ""}
                aria-label={current ? (swap ? `${shown.label}. ${hint}` : shown.label) : hint}
                aria-pressed={!!lit}
                disabled={busy || limited || alreadyRead}
                onClick={() => (current ? swap && pick(swap) : pick(option))}
              >
                <OptionIcon />
                {current && shown.label}
                {swap && <IconSwap size={12} />}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </>
  );
}
