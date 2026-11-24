import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { flushSync } from "react-dom";
import { IconGrip } from "./icons";

// How close to the window's edge a drag starts scrolling the page.
const SCROLL_EDGE = 80;

function moved<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

// Drags rows directly in the DOM, so React only hears about the final order.
function drag(e: PointerEvent<HTMLElement>, from: number, onDrop: (to: number) => void) {
  const handle = e.currentTarget;
  const list = handle.closest("ul");
  if (!list || e.button !== 0) return;
  const rows = [...list.children] as HTMLElement[];
  const row = rows[from];
  const boxes = rows.map((r) => {
    const { top, height } = r.getBoundingClientRect();
    return { top: top + window.scrollY, height, center: top + window.scrollY + height / 2 };
  });
  const { top, height } = boxes[from];
  const last = boxes[boxes.length - 1];
  const startY = e.clientY + window.scrollY;
  const abort = new AbortController();
  let y = e.clientY;
  let to = from;
  let frame = 0;

  function place() {
    const wanted = top + y + window.scrollY - startY;
    const at = Math.min(Math.max(wanted, boxes[0].top), last.top + last.height - height);
    to = from;
    while (to < rows.length - 1 && at + height > boxes[to + 1].center) to++;
    while (to > 0 && at < boxes[to - 1].center) to--;
    rows.forEach((r, i) => {
      const shift = i > from && i <= to ? -height : i < from && i >= to ? height : 0;
      r.style.transform = i === from ? `translateY(${at - top}px)` : shift ? `translateY(${shift}px)` : "";
    });
  }

  function scroll() {
    const over = Math.min(y - SCROLL_EDGE, 0) || Math.max(y - window.innerHeight + SCROLL_EDGE, 0);
    if (over) {
      window.scrollBy(0, over / 6);
      place();
    }
    frame = requestAnimationFrame(scroll);
  }

  function finish(drop: boolean) {
    abort.abort();
    cancelAnimationFrame(frame);
    list?.classList.remove("sorting");
    row.classList.remove("dragging");
    for (const r of rows) r.style.transform = "";
    if (drop && to !== from) onDrop(to);
  }

  const { signal } = abort;
  const onMove = (ev: globalThis.PointerEvent) => {
    y = ev.clientY;
    place();
  };
  handle.addEventListener("pointermove", onMove as EventListener, { signal });
  handle.addEventListener("pointerup", () => finish(true), { signal });
  handle.addEventListener("pointercancel", () => finish(false), { signal });
  document.addEventListener("keydown", (ev) => ev.key === "Escape" && finish(false), { signal });

  handle.setPointerCapture(e.pointerId);
  list.classList.add("sorting");
  row.classList.add("dragging");
  frame = requestAnimationFrame(scroll);
}

// A ranked list, reordered by dragging a row's handle or with the arrow keys on it.
export function SortableList<T>({
  items,
  itemKey,
  onReorder,
  children,
}: {
  items: T[];
  itemKey: (item: T) => number;
  onReorder: (next: T[]) => void;
  children: (item: T, index: number) => ReactNode;
}) {
  function onKeyDown(e: KeyboardEvent<HTMLElement>, from: number) {
    const to = from + (e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0);
    if (to === from) return;
    e.preventDefault();
    if (to < 0 || to >= items.length) return;
    const handle = e.currentTarget;
    flushSync(() => onReorder(moved(items, from, to)));
    handle.focus();
  }

  return (
    <ul className="book-list">
      {items.map((item, i) => (
        <li key={itemKey(item)} className="book-row">
          <button
            type="button"
            className="drag-handle"
            onPointerDown={(e) => drag(e, i, (to) => onReorder(moved(items, i, to)))}
            onKeyDown={(e) => onKeyDown(e, i)}
            title="Drag to reorder"
            aria-label={`Ranked ${i + 1}. Drag or use the arrow keys to reorder`}
          >
            <IconGrip size={14} />
            <span className="rank">{i + 1}</span>
          </button>
          {children(item, i)}
        </li>
      ))}
    </ul>
  );
}
