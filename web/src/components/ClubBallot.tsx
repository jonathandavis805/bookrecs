import type { ClubNomination } from "../api";
import { Cover } from "./ui/Book";
import { RemoveButton } from "./ui/RemoveButton";
import { SortableList } from "./ui/SortableList";

export const MAX_RANKED = 3;

const points = (place: number) => `${MAX_RANKED - place} ${MAX_RANKED - place === 1 ? "pt" : "pts"}`;

// The member's ranked choices.
export function ClubBallot({
  ballot,
  nominations,
  onChange,
}: {
  ballot: number[];
  nominations: ClubNomination[];
  onChange: (next: number[]) => void;
}) {
  const byId = new Map(nominations.map((n) => [n.id, n]));

  return (
    <div className="ballot">
      <SortableList items={ballot} itemKey={(id) => id} onReorder={onChange}>
        {(id, i) => {
          const n = byId.get(id);
          return (
            <>
              <Cover url={n?.cover_url} size="sm" />
              <div className="info title">{n?.title}</div>
              <span className="muted">{points(i)}</span>
              <RemoveButton title="Take off your ballot" onClick={() => onChange(ballot.filter((x) => x !== id))} />
            </>
          );
        }}
      </SortableList>
    </div>
  );
}
