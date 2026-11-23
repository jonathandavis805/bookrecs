import { Reorder, useDragControls } from "framer-motion";
import type { ReactNode } from "react";
import { IconGrip, IconX } from "./icons";

const DRAGGING = { scale: 1.02, zIndex: 10, boxShadow: "0 12px 28px rgba(0,0,0,0.15)" };

// A numbered row dragged by its handle, inside a Reorder.Group.
export function SortableRow<T>({
  item,
  rank,
  className = "",
  onDragEnd,
  children,
}: {
  item: T;
  rank: number;
  className?: string;
  onDragEnd?: () => void;
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
      onDragEnd={onDragEnd}
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

export function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn remove" onClick={onClick} title="Remove" aria-label="Remove">
      <IconX />
    </button>
  );
}
