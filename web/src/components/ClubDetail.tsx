import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  type ClubDetailData,
  type ClubMember,
  type ClubNomination,
  errorMessage,
  type SearchHit,
  type User,
} from "../api";
import { useBookSearch } from "../useBookSearch";
import { ClubBallot, MAX_RANKED } from "./ClubBallot";
import { ClubResults } from "./ClubResults";
import { Byline, Cover } from "./ui/Book";
import { IconChevronLeft, IconClock, IconThumbsDown, IconThumbsUp, IconX } from "./ui/icons";
import { ConfirmDialog, Modal } from "./ui/Modal";
import { StatusPicker } from "./ui/StatusPicker";

function goBackToClubs() {
  // Arrived from inside the app (the clubs list)? Go back so the browser
  // history stays sensible. Deep-linked directly? Just open the list.
  if (document.referrer.startsWith(window.location.origin) && window.history.length > 1) {
    window.history.back();
  } else {
    window.location.hash = "#/clubs";
  }
}

function BackToClubs() {
  return (
    <div className="club-back">
      <button type="button" className="link" onClick={goBackToClubs} title="Back to clubs">
        <IconChevronLeft />
        Clubs
      </button>
    </div>
  );
}

const MAX_NOMINATIONS = 3;
const PLACES = ["1st", "2nd", "3rd"];

export default function ClubDetail({ user, clubId }: { user: User; clubId: number }) {
  const [data, setData] = useState<ClubDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [showLeave, setShowLeave] = useState(false);
  const [transferTarget, setTransferTarget] = useState<number | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [showMemberLeave, setShowMemberLeave] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [vetoTarget, setVetoTarget] = useState<ClubNomination | null>(null);
  const [vetoBusy, setVetoBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ClubNomination | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [runoffTitles, setRunoffTitles] = useState<string[] | null>(null);
  // An edited ballot that hasn't been saved yet.
  const [draft, setDraft] = useState<number[] | null>(null);
  const ballotSaves = useRef(0);
  const [runoffBusy, setRunoffBusy] = useState(false);
  const [showResetVote, setShowResetVote] = useState(false);

  const load = useCallback(
    async (background = false) => {
      try {
        const d = await api<{ club: ClubDetailData }>(`/api/clubs/${clubId}`);
        setData(d.club);
        setError("");
      } catch (e) {
        // A background poll shouldn't tear down the page on a transient
        // blip — but losing your membership or the club itself is a real
        // state change worth surfacing immediately.
        const gone = /not a member|haven't joined|Club not found/i.test(errorMessage(e));
        if (!background || gone) {
          setError(errorMessage(e));
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [clubId],
  );

  useEffect(() => {
    load();
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (poll) return;
      poll = setInterval(() => {
        if (document.visibilityState === "visible") load(true);
      }, 5000);
    };

    // Live updates: the server pushes club changes over Server-Sent Events
    // the moment they happen. If the stream can't connect (blocked proxy,
    // unsupported runtime), fall back to 5s polling — which also briefly
    // covers the reconnect gap after the server rotates the stream.
    const es = new EventSource(`/api/clubs/${clubId}/events`);
    es.onopen = () => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };
    es.onerror = () => startPolling();
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.club) {
          setData(d.club);
          setError("");
        }
      } catch {
        // ignore malformed events
      }
    };
    es.addEventListener("gone", (ev) => {
      const e = ev as MessageEvent;
      es.close();
      let msg = "You no longer have access to this club";
      try {
        msg = JSON.parse(e.data).error || msg;
      } catch {
        // keep default
      }
      setData(null);
      setError(msg);
    });

    return () => {
      es.close();
      if (poll) clearInterval(poll);
    };
  }, [clubId, load]);

  if (loading) {
    return (
      <div className="page">
        <BackToClubs />
        <div className="loading">Loading…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <BackToClubs />
        {error && <div className="error">{error}</div>}
      </div>
    );
  }

  const isOwner = data.myRole === "owner";
  const nominating = data.stage === "nominating";
  const runoff = data.stage === "runoff";
  const voting = data.stage === "voting" || runoff;
  const transferCandidates = data.members.filter((m) => m.status === "accepted" && m.role !== "owner");
  const activeNominations = data.nominations.filter((n) => n.vetoed_by == null);
  const inPlay = activeNominations.filter((n) => !n.eliminated);
  const memberCount = data.members.filter((m) => m.status === "accepted").length;
  const myNominations = data.nominations.filter((n) => n.user_id === user.id).length;
  const ballot = draft ?? data.myBallot;
  // Nomination order, which holds still while you rank; books out of the running sink.
  const sortedNominations = [
    ...inPlay,
    ...activeNominations.filter((n) => n.eliminated),
    ...data.nominations.filter((n) => n.vetoed_by != null),
  ];

  async function act(fn: () => Promise<unknown>, message?: string) {
    setError("");
    setInfo("");
    try {
      await fn();
      if (message) setInfo(message);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  // The draft stays up until the last save lands, so live updates can't undo newer edits.
  async function saveBallot(next: number[]) {
    setDraft(next);
    setError("");
    const save = ++ballotSaves.current;
    try {
      const d = await api<{ club: ClubDetailData }>(`/api/clubs/${clubId}/vote`, {
        method: "POST",
        body: JSON.stringify({ ballot: next }),
      });
      if (save === ballotSaves.current) setData(d.club);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (save === ballotSaves.current) setDraft(null);
    }
  }

  async function veto() {
    if (!vetoTarget) return;
    setVetoBusy(true);
    try {
      await api(`/api/clubs/${clubId}/veto`, {
        method: "POST",
        body: JSON.stringify({ nominationId: vetoTarget.id }),
      });
      setVetoTarget(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setVetoBusy(false);
    }
  }

  async function removeNomination() {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      await api(`/api/clubs/${clubId}/nominations/${removeTarget.id}`, { method: "DELETE" });
      setRemoveTarget(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRemoveBusy(false);
    }
  }

  async function closeVote() {
    setError("");
    setInfo("");
    try {
      await api(`/api/clubs/${clubId}/close-vote`, { method: "POST" });
      setInfo("Vote closed — winner picked.");
      await load();
    } catch (e) {
      // Only a tie can't be closed outright — offer the runoff that settles it.
      if (e instanceof ApiError && Array.isArray(e.data.runoffTitles)) setRunoffTitles(e.data.runoffTitles);
      else setError(errorMessage(e));
    }
  }

  async function startRunoff() {
    setRunoffBusy(true);
    try {
      await api(`/api/clubs/${clubId}/runoff`, { method: "POST" });
      setRunoffTitles(null);
      setInfo("Runoff started — everyone votes again between the tied books.");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunoffBusy(false);
    }
  }

  async function openNominations() {
    await act(
      () => api(`/api/clubs/${clubId}/open-nominations`, { method: "POST" }),
      "Nominations are open for the next pick.",
    );
  }

  async function startVoting() {
    await act(
      () => api(`/api/clubs/${clubId}/start-voting`, { method: "POST" }),
      "Voting is open — nominations are locked.",
    );
  }

  async function backToNominations() {
    setShowResetVote(false);
    await act(
      () => api(`/api/clubs/${clubId}/back-to-nominations`, { method: "POST" }),
      "Voting reset — back to nominations.",
    );
  }

  async function removeMember(userId: number) {
    await act(() => api(`/api/clubs/${clubId}/members/${userId}`, { method: "DELETE" }));
  }

  async function leave() {
    setLeaveBusy(true);
    try {
      await api(`/api/clubs/${clubId}/leave`, { method: "POST" });
      window.location.hash = "#/clubs";
    } catch (e) {
      setError(errorMessage(e));
      setLeaveBusy(false);
      setShowMemberLeave(false);
    }
  }

  function requestLeave() {
    // The owner can't just leave — they have to hand the club over
    // (transfer & leave) or delete it.
    if (isOwner) {
      setTransferTarget(null);
      setShowLeave(true);
      return;
    }
    setShowMemberLeave(true);
  }

  async function transferAndLeave() {
    if (transferTarget == null) return;
    setTransferBusy(true);
    try {
      await api(`/api/clubs/${clubId}/transfer`, {
        method: "POST",
        body: JSON.stringify({ userId: transferTarget }),
      });
      window.location.hash = "#/clubs";
    } catch (e) {
      setError(errorMessage(e));
      setTransferBusy(false);
    }
  }

  function requestDelete() {
    setShowDelete(true);
  }

  async function deleteClub() {
    setDeleteBusy(true);
    try {
      await api(`/api/clubs/${clubId}`, { method: "DELETE" });
      window.location.hash = "#/clubs";
    } catch (e) {
      setError(errorMessage(e));
      setDeleteBusy(false);
      setShowDelete(false);
    }
  }

  return (
    <div className="page">
      <BackToClubs />
      <div className="page-head">
        <h2>{data.club.name}</h2>
        {data.club.description && <p className="muted">{data.club.description}</p>}
      </div>

      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}

      {data.currentPick && <CurrentPick pick={data.currentPick} onMoved={load} />}

      <section className="club-section">
        <h3 className="section-title">
          {nominating ? "Nominate the next book" : voting ? "Vote for the next book" : "Voting"}
        </h3>
        {!voting && !nominating && (
          <div className="club-closed-row">
            <span className="muted">Voting is closed. The winner is the current read; the full results are below.</span>
            {isOwner && (
              <button type="button" className="btn-primary" onClick={openNominations}>
                Start nominations
              </button>
            )}
          </div>
        )}

        {nominating && (
          <>
            {isOwner && (
              <div className="club-owner-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startVoting}
                  disabled={activeNominations.length === 0}
                  title={
                    activeNominations.length === 0
                      ? "Nominate at least one book first"
                      : "Lock nominations and open the vote"
                  }
                >
                  Start voting
                </button>
              </div>
            )}

            {myNominations < MAX_NOMINATIONS ? (
              <NominatePane clubId={clubId} onNominated={load} />
            ) : (
              <div className="empty club-nominate">
                You've used all {MAX_NOMINATIONS} of your nominations. Withdraw one to swap it.
              </div>
            )}

            {data.nominations.length === 0 ? (
              <div className="empty">No nominations yet — suggest the first book.</div>
            ) : (
              <motion.ul className="plain-list" layout>
                {sortedNominations.map((n) => (
                  <NominationRow
                    key={n.id}
                    n={n}
                    voting={false}
                    canRemove={isOwner || (n.user_id === user.id && n.vetoed_by == null)}
                    onRemove={() => setRemoveTarget(n)}
                  />
                ))}
              </motion.ul>
            )}

            <div className="muted club-myvote-note">
              {Math.min(myNominations, MAX_NOMINATIONS)} of your {MAX_NOMINATIONS} nominations used. The owner starts
              the vote once the field is set.
            </div>
          </>
        )}

        {voting && (
          <>
            {isOwner && (
              <div className="club-owner-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={closeVote}
                  disabled={inPlay.length === 0 || data.votedCount === 0}
                  title={
                    activeNominations.length === 0
                      ? data.nominations.length > 0
                        ? "Every nomination was vetoed"
                        : "Nominate at least one book first"
                      : data.votedCount === 0
                        ? "Waiting for votes"
                        : "Most points wins"
                  }
                >
                  {runoff ? "Close runoff & pick winner" : "Close voting & pick winner"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowResetVote(true)}
                  title="Clear all votes and reopen nominations"
                >
                  Back to nominations
                </button>
              </div>
            )}

            {runoff && (
              <div className="club-runoff-banner">
                <IconClock size={18} />
                <span>
                  <strong>Runoff</strong> — {inPlay.map((n) => `"${n.title}"`).join(" vs ")}. Vote again between these
                  to break the tie.
                </span>
              </div>
            )}

            <p className="muted results-note">
              Rank up to three books, best first. Points stay hidden until voting closes. {data.votedCount} of{" "}
              {memberCount} {memberCount === 1 ? "member has" : "members have"} voted.
            </p>
            <ClubBallot
              ballot={ballot}
              nominations={data.nominations}
              onReorder={setDraft}
              onDrop={() => draft && saveBallot(draft)}
              onRemove={(id) => saveBallot(ballot.filter((x) => x !== id))}
            />

            {data.nominations.length === 0 ? (
              <div className="empty">No nominations yet — suggest the first book.</div>
            ) : (
              <motion.ul className="plain-list" layout>
                {sortedNominations.map((n) => (
                  <NominationRow
                    key={n.id}
                    n={n}
                    voting
                    place={ballot.indexOf(n.id)}
                    ballotFull={ballot.length >= MAX_RANKED}
                    canVeto={!data.myVetoUsed}
                    canRemove={isOwner && !n.eliminated}
                    onVote={() =>
                      saveBallot(ballot.includes(n.id) ? ballot.filter((x) => x !== n.id) : [...ballot, n.id])
                    }
                    onVeto={() => setVetoTarget(n)}
                    onRemove={() => setRemoveTarget(n)}
                  />
                ))}
              </motion.ul>
            )}

            <div className="muted club-myvote-note">
              {data.myVetoUsed
                ? "You've used your veto for this vote."
                : "You also get one veto — it strikes a book for everyone and can't be undone."}
            </div>
          </>
        )}
      </section>

      {data.currentPick && (
        <ClubResults clubId={clubId} current={data.currentPick} past={data.pastPicks} onMoved={load} />
      )}

      <section className="club-section">
        <h3 className="section-title">Members ({memberCount})</h3>
        <MembersPane
          data={data}
          userId={user.id}
          isOwner={isOwner}
          onRemove={removeMember}
          onInvited={load}
          onError={setError}
        />
        <div className="club-footer-actions">
          <button type="button" className="link danger" onClick={requestLeave}>
            Leave this club
          </button>
          {isOwner && (
            <button type="button" className="link danger" onClick={requestDelete}>
              Delete this club
            </button>
          )}
        </div>
      </section>

      {data.pastPicks.length > 0 && (
        <section className="club-section">
          <h3 className="section-title">Past picks</h3>
          <ul className="plain-list">
            {data.pastPicks.map((p) => (
              <li key={p.id} className="book-row club-book-row">
                <Cover url={p.cover_url} size="sm" />
                <div className="info">
                  <div className="title">
                    <a href={`#/book/${p.book_id}`} className="book-title-link">
                      {p.title}
                    </a>
                  </div>
                  <Byline author={p.author} year={p.first_publish_year} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showMemberLeave && (
        <ConfirmDialog
          title="Leave this club"
          confirmLabel="Leave club"
          busyLabel="Leaving…"
          busy={leaveBusy}
          danger
          onConfirm={leave}
          onCancel={() => setShowMemberLeave(false)}
        >
          Leave "{data.club.name}"? You'll need a new invite to rejoin.
        </ConfirmDialog>
      )}

      {showLeave && (
        <Modal title="Leave this club" onClose={() => setShowLeave(false)}>
          <div className="modal-body">
            <p className="muted">
              You own this club. Transfer ownership to one of its members to leave — or delete the club for everyone.
            </p>
            {transferCandidates.length > 0 ? (
              <>
                <div className="field">
                  <span className="field-label">Transfer ownership to</span>
                  <div className="chip-picker">
                    {transferCandidates.map((m) => (
                      <button
                        type="button"
                        key={m.user_id}
                        className={`chip${transferTarget === m.user_id ? " picked" : ""}`}
                        onClick={() => setTransferTarget(m.user_id)}
                      >
                        {m.username}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowLeave(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={transferTarget == null || transferBusy}
                    onClick={transferAndLeave}
                  >
                    {transferBusy ? "Transferring…" : "Transfer ownership & leave"}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty">You're the only member. Invite someone first — or delete the club below.</div>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="link danger"
                onClick={() => {
                  setShowLeave(false);
                  requestDelete();
                }}
              >
                Delete this club instead
              </button>
            </div>
          </div>
        </Modal>
      )}

      {runoffTitles && (
        <ConfirmDialog
          title="It's a tie"
          confirmLabel="Start runoff"
          busyLabel="Starting…"
          busy={runoffBusy}
          onConfirm={startRunoff}
          onCancel={() => setRunoffTitles(null)}
        >
          {runoffTitles.map((t) => `"${t}"`).join(" and ")} are tied. Start a runoff? Everyone votes again between just
          these books.
        </ConfirmDialog>
      )}

      {showResetVote && (
        <ConfirmDialog
          title="Reset voting?"
          confirmLabel="Reset voting"
          onConfirm={backToNominations}
          onCancel={() => setShowResetVote(false)}
        >
          All cast votes are cleared{runoff ? " and the runoff ends" : ""}, and the club goes back to the nomination
          stage. Nominations stay so the field can be adjusted before voting again.
        </ConfirmDialog>
      )}

      {vetoTarget && (
        <ConfirmDialog
          title="Veto this book"
          confirmLabel="Veto book"
          busyLabel="Vetoing…"
          busy={vetoBusy}
          danger
          onConfirm={veto}
          onCancel={() => setVetoTarget(null)}
        >
          Veto "{vetoTarget.title}"? It's struck from this vote and ballots ranking it move their later choices up. You
          only get one veto per vote, and this can't be undone.
        </ConfirmDialog>
      )}

      {removeTarget && (
        <ConfirmDialog
          title="Remove this book"
          confirmLabel="Remove book"
          busyLabel="Removing…"
          busy={removeBusy}
          danger
          onConfirm={removeNomination}
          onCancel={() => setRemoveTarget(null)}
        >
          Remove "{removeTarget.title}" from the vote? It leaves the list entirely, along with any votes for it, and can
          be nominated again like new.
        </ConfirmDialog>
      )}

      {showDelete && (
        <ConfirmDialog
          title="Delete this club"
          confirmLabel="Delete club"
          busyLabel="Deleting…"
          busy={deleteBusy}
          danger
          onConfirm={deleteClub}
          onCancel={() => setShowDelete(false)}
        >
          Delete "{data.club.name}"? Nominations, votes, and picks are removed for every member. This can't be undone.
        </ConfirmDialog>
      )}
    </div>
  );
}

function NominatePane({ clubId, onNominated }: { clubId: number; onNominated: () => void }) {
  const [q, setQ] = useState("");
  const { hits, searching, error: searchError } = useBookSearch(q, true);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  async function nominate(hit: SearchHit) {
    setStatus((s) => ({ ...s, [hit.key]: "Nominating…" }));
    setError("");
    try {
      await api(`/api/clubs/${clubId}/nominate`, {
        method: "POST",
        body: JSON.stringify(hit.bookId != null ? { book_id: hit.bookId } : { ol_key: hit.key, year: hit.year }),
      });
      setStatus((s) => ({ ...s, [hit.key]: "Nominated" }));
      setQ("");
      onNominated();
    } catch (e) {
      setStatus((s) => ({ ...s, [hit.key]: "" }));
      setError(errorMessage(e));
    }
  }

  return (
    <div className="club-nominate">
      <div className="search-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your lists or Open Library…" />
        {searching && <span className="searching-indicator">Searching…</span>}
      </div>
      {(error || searchError) && <div className="error">{error || searchError}</div>}
      {hits.length > 0 && (
        <ul className="result-list">
          {hits.map((h) => {
            const st = status[h.key];
            return (
              <li key={h.key} className="book-row">
                <Cover url={h.coverUrl} />
                <div className="info">
                  <div className="title">
                    {h.title}
                    {h.mine && (
                      <span className="badge">
                        {h.mine === "reading" ? "Reading" : h.mine === "wish" ? "Wishlist" : "Read"}
                      </span>
                    )}
                  </div>
                  <Byline author={h.author} year={h.year} />
                </div>
                <div className="actions">
                  {st === "Nominated" ? (
                    <span className="success-text">Nominated</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => nominate(h)}
                      disabled={st === "Nominating…" || st === "Nominated"}
                    >
                      {st === "Nominating…" ? "…" : "Nominate"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NominationRow({
  n,
  voting,
  place = -1,
  ballotFull = false,
  canVeto = false,
  canRemove,
  onVote,
  onVeto,
  onRemove,
}: {
  n: ClubNomination;
  voting: boolean;
  place?: number;
  ballotFull?: boolean;
  canVeto?: boolean;
  canRemove: boolean;
  onVote?: () => void;
  onVeto?: () => void;
  onRemove: () => void;
}) {
  const vetoed = n.vetoed_by != null;
  const ranked = place !== -1;
  const voteLabel = ranked ? "Remove from your ballot" : ballotFull ? "Your ballot is full" : "Add to your ballot";
  return (
    <motion.li
      layout
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className={`book-row club-book-row${ranked ? " my-vote" : ""}${vetoed || n.eliminated ? " vetoed" : ""}`}
    >
      <Cover url={n.cover_url} />
      <div className="info">
        <div className="title">
          {n.title}
          {ranked && <span className="badge accent">Your {PLACES[place]}</span>}
          {vetoed && <span className="badge danger">Vetoed by {n.vetoedBy ?? "a member"}</span>}
          {!vetoed && !!n.eliminated && <span className="badge">Not in the runoff</span>}
        </div>
        <Byline author={n.author} year={n.first_publish_year} extra={`nominated by ${n.nominatedBy}`} />
      </div>
      <div className="actions">
        {!vetoed && !n.eliminated && voting && (
          <>
            <button
              type="button"
              className={`btn-secondary vote-btn${ranked ? " on" : ""}`}
              onClick={onVote}
              disabled={ballotFull && !ranked}
              title={voteLabel}
              aria-label={`${voteLabel}: ${n.title}`}
              aria-pressed={ranked}
            >
              <IconThumbsUp />
            </button>
            {canVeto && (
              <button
                type="button"
                className="danger"
                onClick={onVeto}
                title="Veto: strike this book (one veto per vote)"
                aria-label={`Veto ${n.title}`}
              >
                <IconThumbsDown />
              </button>
            )}
          </>
        )}
        {canRemove && (
          <button
            type="button"
            className="icon-btn remove"
            onClick={onRemove}
            title="Remove from the vote"
            aria-label="Remove nomination"
          >
            <IconX size={14} />
          </button>
        )}
      </div>
    </motion.li>
  );
}

function CurrentPick({
  pick,
  onMoved,
}: {
  pick: NonNullable<ClubDetailData["currentPick"]>;
  onMoved: () => Promise<void>;
}) {
  return (
    <section className="card">
      <h3 className="section-title">Current read</h3>
      <div className="book-row">
        <Cover url={pick.cover_url} />
        <div className="info">
          <div className="title">
            <a href={`#/book/${pick.book_id}`} className="book-title-link">
              {pick.title}
            </a>
          </div>
          <Byline author={pick.author} year={pick.first_publish_year} />
        </div>
        <div className="actions">
          <StatusPicker status={pick.mine} book={{ book_id: pick.book_id }} onChange={() => onMoved()} />
        </div>
      </div>
    </section>
  );
}

function MembersPane({
  data,
  userId,
  isOwner,
  onRemove,
  onInvited,
  onError,
}: {
  data: ClubDetailData;
  userId: number;
  isOwner: boolean;
  onRemove: (userId: number) => void;
  onInvited: () => void;
  onError: (msg: string) => void;
}) {
  const [friends, setFriends] = useState<{ user_id: number; username: string }[]>([]);
  const [inviteQ, setInviteQ] = useState("");
  const [addQ, setAddQ] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [note, setNote] = useState("");

  function loadFriends() {
    fetchFriends().then(setFriends);
  }

  useEffect(() => {
    fetchFriends().then(setFriends);
  }, []);

  const memberIds = new Set(data.members.map((m) => m.user_id));
  const accepted = data.members.filter((m) => m.status === "accepted");
  const pending = data.members.filter((m) => m.status === "pending");
  const inviteCandidates = friends.filter(
    (f) =>
      !memberIds.has(f.user_id) && (!inviteQ.trim() || f.username.toLowerCase().includes(inviteQ.trim().toLowerCase())),
  );

  async function invite(username: string) {
    onError("");
    try {
      await api(`/api/clubs/${data.club.id}/invite`, {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      setInviteQ("");
      onInvited();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  // Add someone who isn't a friend yet: send a friend request (a mutual
  // request auto-accepts, and we invite them right away). Existing friends
  // are invited directly.
  async function addByUsername(e: React.FormEvent) {
    e.preventDefault();
    const q = addQ.trim();
    if (!q || addBusy) return;
    setAddBusy(true);
    setNote("");
    onError("");
    try {
      const existing = friends.find((f) => f.username.toLowerCase() === q.toLowerCase());
      if (existing) {
        await invite(existing.username);
        setAddQ("");
        return;
      }
      const r = await api<{ username?: string; autoAccepted?: boolean }>("/api/friends/requests", {
        method: "POST",
        body: JSON.stringify({ usernameOrEmail: q }),
      });
      setAddQ("");
      if (r.autoAccepted && r.username) {
        await api(`/api/clubs/${data.club.id}/invite`, {
          method: "POST",
          body: JSON.stringify({ username: r.username }),
        });
        setNote(`You're now friends with ${r.username} — invite sent.`);
        loadFriends();
        onInvited();
      } else {
        setNote(`Friend request sent to ${r.username ?? q} — you can invite them once they accept.`);
      }
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setAddBusy(false);
    }
  }

  function memberRow(m: ClubMember) {
    return (
      <li key={m.user_id} className="club-member">
        <a href={`#/u/${encodeURIComponent(m.username)}`} className="club-member-name">
          {m.username}
        </a>
        <span className="muted club-member-tags">
          {m.role === "owner" ? "owner" : "member"}
          {m.status === "pending" && " · invited"}
          {m.user_id === userId && " · you"}
        </span>
        {isOwner && m.role !== "owner" && (
          <button
            type="button"
            className="icon-btn remove"
            title={m.status === "pending" ? "Cancel invite" : "Remove from club"}
            aria-label={m.status === "pending" ? "Cancel invite" : "Remove from club"}
            onClick={() => onRemove(m.user_id)}
          >
            <IconX size={14} />
          </button>
        )}
      </li>
    );
  }

  return (
    <div>
      <ul className="club-member-list">{accepted.map(memberRow)}</ul>
      {pending.length > 0 && (
        <>
          <div className="field-label club-invited-label">Invited ({pending.length})</div>
          <ul className="club-member-list">{pending.map(memberRow)}</ul>
        </>
      )}
      <div className="club-invite-box">
        <span className="field-label">Invite a friend</span>
        {inviteCandidates.length > 0 && (
          <>
            <input value={inviteQ} onChange={(e) => setInviteQ(e.target.value)} placeholder="Filter your friends…" />
            <div className="chip-picker">
              {inviteCandidates.map((f) => (
                <button key={f.user_id} type="button" className="chip" onClick={() => invite(f.username)}>
                  {f.username}
                </button>
              ))}
            </div>
          </>
        )}
        <form className="search-bar" onSubmit={addByUsername}>
          <input value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder="Add by username or email…" />
          <button type="submit" className="btn-secondary" disabled={addBusy}>
            {addBusy ? "…" : "Add"}
          </button>
        </form>
        {note && <div className="muted">{note}</div>}
      </div>
    </div>
  );
}

function fetchFriends() {
  return api<{ friends: { user_id: number; username: string }[] }>("/api/friends")
    .then((d) => d.friends)
    .catch(() => []);
}
