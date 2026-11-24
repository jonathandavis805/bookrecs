import { useEffect, useState } from "react";
import { api, type ClubDetailData, type ClubPick, errorMessage, type ClubResults as Results } from "../api";
import { Byline, Cover } from "./ui/Book";
import { IconChevronLeft, IconChevronRight } from "./ui/icons";
import { StatusPicker } from "./ui/StatusPicker";

type Result = Results["nominations"][number];

function breakdown(n: Result): string {
  const counts = [
    [n.firsts, "1st"],
    [n.seconds, "2nd"],
    [n.thirds, "3rd"],
  ] as const;
  return counts
    .filter(([count]) => count > 0)
    .map(([count, place]) => ` · ${count} as ${place}`)
    .join("");
}

const sameResult = (a: Result, b: Result) =>
  a.eliminated === b.eliminated && a.points === b.points && a.firsts === b.firsts && a.seconds === b.seconds;

// Every closed round, newest first.
export function ClubResults({
  clubId,
  current,
  past,
  onMoved,
}: {
  clubId: number;
  current: NonNullable<ClubDetailData["currentPick"]>;
  past: ClubPick[];
  onMoved: () => Promise<void>;
}) {
  const picks = [current, ...past];
  const [pickId, setPickId] = useState<number | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState("");

  const found = picks.findIndex((p) => p.id === pickId);
  const page = found === -1 ? 0 : found;
  const pick = picks[page];

  useEffect(() => {
    let superseded = false;
    setResults(null);
    setError("");
    api<{ results: Results }>(`/api/clubs/${clubId}/results/${pick.id}`)
      .then((d) => !superseded && setResults(d.results))
      .catch((e) => !superseded && setError(errorMessage(e)));
    return () => {
      superseded = true;
    };
  }, [clubId, pick.id]);

  // The newest round isn't pinned, so a round closing while it's open moves on to it.
  const show = (index: number) => setPickId(index === 0 ? null : picks[index].id);
  const runoff = results?.nominations.some((n) => n.eliminated);

  return (
    <section>
      <div className="card-head">
        <h3 className="section-title">Results</h3>
        <div className="actions">
          <button
            type="button"
            className="icon-btn"
            title="Older round"
            aria-label="Older round"
            disabled={page === picks.length - 1}
            onClick={() => show(page + 1)}
          >
            <IconChevronLeft />
          </button>
          <span className="muted">
            {new Date(pick.picked_at * 1000).toLocaleDateString(undefined, { dateStyle: "medium" })}
          </span>
          <button
            type="button"
            className="icon-btn"
            title="Newer round"
            aria-label="Newer round"
            disabled={page === 0}
            onClick={() => show(page - 1)}
          >
            <IconChevronRight />
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!results && !error && <div className="loading">Loading…</div>}
      {results?.nominations.length === 0 && (
        <div className="empty">"{pick.title}" won. The other results weren't kept for this round.</div>
      )}
      {results && results.nominations.length > 0 && (
        <>
          <p className="muted results-note">
            {results.voters} {results.voters === 1 ? "member" : "members"} voted
            {runoff ? " in total. It took a runoff" : ""}.
          </p>
          <ul className="book-list">
            {results.nominations.map((n) => {
              const vetoed = n.vetoed_by != null;
              const won = n.book_id === pick.book_id;
              return (
                <li key={n.id} className={`book-row${vetoed ? " out" : ""}`}>
                  <span className="rank">
                    {vetoed ? "–" : results.nominations.findIndex((x) => sameResult(x, n)) + 1}
                  </span>
                  <Cover url={n.cover_url} />
                  <div className="info">
                    <div className="title">
                      <a href={`#/book/${n.book_id}`} className="book-title-link">
                        {n.title}
                      </a>
                      {won && <span className="badge">Winner</span>}
                    </div>
                    <Byline author={n.author} year={n.first_publish_year} extra={`nominated by ${n.nominatedBy}`} />
                    <div className="tally">
                      {vetoed ? (
                        `Vetoed by ${n.vetoedBy ?? "a member"}`
                      ) : (
                        <>
                          <strong>
                            {n.points} {n.points === 1 ? "pt" : "pts"}
                          </strong>
                          {breakdown(n)}
                          {runoff && (n.eliminated ? " · first round" : " · runoff")}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="actions">
                    <StatusPicker
                      status={n.book_id === current.book_id ? current.mine : n.mine}
                      book={{ book_id: n.book_id }}
                      onChange={(next) => {
                        setResults(
                          (r) =>
                            r && {
                              ...r,
                              nominations: r.nominations.map((x) => (x.id === n.id ? { ...x, mine: next } : x)),
                            },
                        );
                        // The current read shows its status above too.
                        if (n.book_id === current.book_id) onMoved();
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
