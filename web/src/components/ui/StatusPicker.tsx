import { type PointerEvent, useLayoutEffect, useRef, useState } from "react";
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

// How far a finger moves before it's sliding rather than tapping.
const SLIDE_START = 8;
// How far outside the picker a sliding finger lets go of it.
const SLIDE_AWAY = 40;

// The pill behind the lit option. It glides between options and tracks a finger
// sliding along them, previewing what each would do as hovering does with a
// mouse. Letting go picks the option (`release` says whether it could); sliding
// well away from the picker, or back to the resting option, changes nothing.
function useSlidingThumb(resting: Status | null, status: MineStatus, release: (option: Status) => boolean) {
  const [preview, setPreview] = useState<Status | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const startX = useRef<number | null>(null);
  const slid = useRef(false);
  const target = preview ?? resting;

  // Each option's place in the group; the anchors aren't scaled while pressed.
  const anchors = () => [...(group.current?.querySelectorAll<HTMLElement>(".tooltip-anchor") ?? [])];

  function settle(to: Status | null) {
    const pill = thumb.current;
    const anchor = anchors()[OPTIONS.findIndex((o) => o.value === to)];
    if (!pill) return;
    pill.classList.remove("tracking");
    if (!anchor) {
      pill.style.opacity = "0";
      return;
    }
    // Appearing from nowhere shouldn't glide in from the edge.
    const still = pill.style.opacity !== "1";
    pill.classList.toggle("still", still);
    pill.style.width = `${anchor.offsetWidth}px`;
    pill.style.transform = `translateX(${anchor.offsetLeft}px)`;
    pill.style.opacity = "1";
    if (still) void pill.offsetWidth;
    pill.classList.remove("still");
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: status resizes the options
  useLayoutEffect(() => {
    if (!slid.current || startX.current === null) settle(target);
    const observer = new ResizeObserver(() => startX.current === null && settle(target));
    if (group.current) observer.observe(group.current);
    return () => observer.disconnect();
  }, [target, status]);

  function track(x: number, y: number) {
    const box = group.current?.getBoundingClientRect();
    if (!box) return;
    const away = Math.max(box.left - x, x - box.right, box.top - y, y - box.bottom);
    if (away > SLIDE_AWAY) {
      setPreview(null);
      settle(resting);
      return;
    }
    const pill = thumb.current;
    const spots = anchors();
    const last = spots.at(-1);
    if (!pill || !group.current || !last) return;
    const at = x - box.left - group.current.clientLeft;
    const found = spots.findIndex((s) => at <= s.offsetLeft + s.offsetWidth);
    const index = found === -1 ? spots.length - 1 : found;
    const width = spots[index].offsetWidth;
    const end = last.offsetLeft + last.offsetWidth - width;
    pill.classList.add("tracking");
    pill.style.width = `${width}px`;
    pill.style.transform = `translateX(${Math.min(Math.max(at - width / 2, spots[0].offsetLeft), end)}px)`;
    pill.style.opacity = "1";
    setPreview(OPTIONS[index].value);
  }

  function end(chosen: Status | null) {
    startX.current = null;
    if (!slid.current) return;
    setPreview(null);
    settle(chosen && chosen !== resting && release(chosen) ? chosen : resting);
  }

  const handlers = {
    onPointerDown(e: PointerEvent) {
      slid.current = false;
      startX.current = e.pointerType === "touch" ? e.clientX : null;
    },
    onPointerMove(e: PointerEvent) {
      if (startX.current === null) return;
      if (Math.abs(e.clientX - startX.current) > SLIDE_START) slid.current = true;
      if (slid.current) track(e.clientX, e.clientY);
    },
    onPointerUp: () => end(preview),
    onPointerCancel: () => end(null),
    onClickCapture(e: { stopPropagation: () => void }) {
      if (slid.current) e.stopPropagation();
      slid.current = false;
    },
  };
  return { preview, group, thumb, handlers };
}

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
  // The option being saved; the pill moves there without waiting.
  const [pending, setPending] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const shown = status ? STATUSES[status] : null;
  const { preview, group, thumb, handlers } = useSlidingThumb(
    pending ?? shown?.on ?? null,
    status ?? null,
    (option) => {
      if (pending || unavailable(option)) return false;
      pick(option, option);
      return true;
    },
  );

  // The server keeps books you've read off the wishlist.
  const alreadyRead = shown?.on === "read" || shown?.again;
  function unavailable(option: Status): boolean {
    return (option === "wish" && !!alreadyRead) || (option === "read" && atLimit && !shown);
  }

  async function pick(option: Status, next: Pick) {
    if (pending) return;
    setPending(option);
    setError("");
    try {
      const body = JSON.stringify({ ...book, status: next });
      const { mine } = await api<{ mine: MineStatus }>("/api/me/status", { method: "POST", body });
      onChange(mine);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      {error && <span className="error-text">{error}</span>}
      <div ref={group} className="segmented compact status-picker sliding" {...handlers}>
        <span ref={thumb} className="status-thumb" />
        {OPTIONS.map(({ value: option, Icon }) => {
          const current = shown?.on === option;
          const swap = current ? shown.swap : undefined;
          const hint = current
            ? swap
              ? SWAP_HINTS[swap]
              : "On your wishlist"
            : option === "read" && unavailable(option)
              ? "Book limit reached"
              : moveHint(option, status ?? null);
          const OptionIcon = current && shown.audio ? IconHeadphones : Icon;
          const lit = current || (shown?.again && option === "read");
          const target = preview ?? pending;
          const highlighted = target ? target === option : lit;
          // Rereading lights a second option, which the pill doesn't cover.
          const also = highlighted && !target && !current;
          return (
            <Tooltip key={option} label={current && preview ? shown.label : hint} held={preview === option}>
              <button
                type="button"
                className={`${highlighted ? "active" : ""}${also ? " also" : ""}`}
                aria-label={current ? (swap ? `${shown.label}. ${hint}` : shown.label) : hint}
                aria-pressed={!!lit}
                disabled={unavailable(option)}
                onClick={() => (current ? swap && pick(option, swap) : pick(option, option))}
              >
                <OptionIcon />
                {current && <span className="status-label">{shown.label}</span>}
                {swap && <IconSwap size={12} />}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </>
  );
}
