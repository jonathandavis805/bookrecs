import { IconX } from "./icons";

export function RemoveButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-btn remove" onClick={onClick} title={title} aria-label={title}>
      <IconX size={14} />
    </button>
  );
}
