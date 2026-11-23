import { Reorder } from "framer-motion";
import type { ClubNomination } from "../api";
import { RemoveButton, SortableRow } from "./ui/SortableRow";

export const MAX_RANKED = 3;

const points = (place: number) => `${MAX_RANKED - place} ${MAX_RANKED - place === 1 ? "pt" : "pts"}`;

// The member's ranked choices, with a placeholder for each place still open.
export function ClubBallot({
  ballot,
  nominations,
  onReorder,
  onDrop,
  onRemove,
}: {
  ballot: number[];
  nominations: ClubNomination[];
  onReorder: (next: number[]) => void;
  onDrop: () => void;
  onRemove: (nominationId: number) => void;
}) {
  const titles = new Map(nominations.map((n) => [n.id, n.title]));
  const open = Array.from({ length: MAX_RANKED - ballot.length }, (_, i) => ballot.length + i);

  return (
    <div className="ballot">
      <Reorder.Group axis="y" values={ballot} onReorder={onReorder} className="plain-list">
        {ballot.map((id, i) => (
          <SortableRow key={id} item={id} rank={i + 1} className="ballot-row" onDragEnd={onDrop}>
            <div className="info title">{titles.get(id)}</div>
            <span className="muted">{points(i)}</span>
            <RemoveButton onClick={() => onRemove(id)} />
          </SortableRow>
        ))}
      </Reorder.Group>
      {open.map((place) => (
        <div key={place} className="book-row ballot-row open">
          <span className="rank">#{place + 1}</span>
          <div className="info muted">Add a book below</div>
          <span className="muted">{points(place)}</span>
        </div>
      ))}
    </div>
  );
}
