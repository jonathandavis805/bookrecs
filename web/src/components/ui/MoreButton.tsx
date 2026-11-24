import { IconMore } from "./icons";

// Opens the controls for one row of a list.
export function MoreButton({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="icon-btn more"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`Options for ${title}`}
      title="Options"
    >
      <IconMore size={18} />
    </button>
  );
}
