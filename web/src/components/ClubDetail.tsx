import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  type ClubDetailData,
  type ClubMember,
  type ClubNomination,
  errorMessage,
  type SearchHit,
  type User,
} from "../api";
import { useBookSearch } from "../useBookSearch";
import { Byline, Cover } from "./ui/Book";
import { IconCheck, IconChevronLeft, IconClock, IconThumbsDown, IconThumbsUp, IconX } from "./ui/icons";
import { ConfirmDialog, Modal } from "./ui/Modal";

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

// The runoff field: the top two vote-getters. A tie at the top keeps all
// tied leaders; a single leader is joined by whoever ties for second.
// Mirrors runoffField in src/core/clubs.ts.
function runoffField<T extends { votes: number }>(nominations: T[]): T[] {
  if (nominations.length === 0) return [];
  const topVotes = Math.max(...nominations.map((n) => n.votes));
  const leaders = nominations.filter((n) => n.votes === topVotes);
  if (leaders.length > 1) return leaders;
  const rest = nominations.filter((n) => n.votes < topVotes);
  if (rest.length === 0) return leaders;
  const runnerUpVotes = Math.max(...rest.map((n) => n.votes));
  return [...leaders, ...rest.filter((n) => n.votes === runnerUpVotes)];
}

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
  const [showRunoff, setShowRunoff] = useState(false);
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
  // A tie at the top (books sharing the lead with at least one vote).
  const topVotes = activeNominations.reduce((m, n) => Math.max(m, n.votes), 0);
  const tiedNominations = topVotes > 0 ? activeNominations.filter((n) => n.votes === topVotes) : [];
  // A pick needs a simple majority (more than half the votes cast); anything
  // else goes to a runoff among the top two, ties included.
  const totalVotes = activeNominations.reduce((s, n) => s + n.votes, 0);
  const hasMajority = tiedNominations.length === 1 && tiedNominations[0].votes * 2 > totalVotes;
  const needsRunoff = totalVotes > 0 && !hasMajority;
  const runoffNominations = runoffField(activeNominations);
  // Live order: most votes first (tied books hold their nomination order —
  // they only move when a count actually changes), vetoed nominations sink
  // to the bottom.
  const sortedNominations = [...activeNominations]
    .sort((a, b) => b.votes - a.votes || a.created_at - b.created_at || a.id - b.id)
    .concat(data.nominations.filter((n) => n.vetoed_by != null));

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

  async function vote(nominationId: number) {
    await act(() =>
      api(`/api/clubs/${clubId}/vote`, {
        method: "POST",
        body: JSON.stringify({ nominationId }),
      }),
    );
  }

  async function unvote() {
    await act(() => api(`/api/clubs/${clubId}/vote`, { method: "DELETE" }));
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
    // No majority (a tie or a narrow lead) needs a runoff — offer it
    // instead of failing.
    if (needsRunoff) {
      setShowRunoff(true);
      return;
    }
    await act(() => api(`/api/clubs/${clubId}/close-vote`, { method: "POST" }), "Vote closed — winner picked.");
  }

  async function startRunoff() {
    setRunoffBusy(true);
    try {
      await api(`/api/clubs/${clubId}/runoff`, { method: "POST" });
      setShowRunoff(false);
      setInfo("Runoff started — votes reset for the runoff books.");
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

      {data.currentPick && <CurrentPick pick={data.currentPick} onStarted={load} />}

      <section className="club-section">
        <h3 className="section-title">
          {nominating ? "Nominate the next book" : voting ? "Vote for the next book" : "Voting"}
        </h3>
        {!voting && !nominating && (
          <div className="club-closed-row">
            <span className="muted">Voting is closed. The winner is shown above as the current read.</span>
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

            <NominatePane clubId={clubId} onNominated={load} />

            {data.nominations.length === 0 ? (
              <div className="empty">No nominations yet — suggest the first book.</div>
            ) : (
              <motion.ul className="plain-list" layout>
                {sortedNominations.map((n) => (
                  <NominationRow
                    key={n.id}
                    n={n}
                    voting={false}
                    myVote={false}
                    canVeto={false}
                    isOwner={isOwner}
                    onVote={() => {}}
                    onUnvote={() => {}}
                    onVeto={() => {}}
                    onRemove={() => setRemoveTarget(n)}
                  />
                ))}
              </motion.ul>
            )}

            <div className="muted club-myvote-note">
              Nominations are open — the owner starts the vote once the field is set.
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
                  disabled={activeNominations.length === 0 || activeNominations.every((n) => n.votes === 0)}
                  title={
                    activeNominations.length === 0
                      ? data.nominations.length > 0
                        ? "Every nomination was vetoed"
                        : "Nominate at least one book first"
                      : needsRunoff
                        ? "No majority yet — a runoff will resolve it"
                        : activeNominations.every((n) => n.votes === 0)
                          ? "Waiting for votes"
                          : "Majority wins"
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
                  <strong>Runoff</strong> — {activeNominations.map((n) => `"${n.title}"`).join(" vs ")}. Votes were
                  reset; cast yours again to break the tie.
                </span>
              </div>
            )}

            <div className="muted club-myvote-note">Nominations are closed while voting is open.</div>

            {data.nominations.length === 0 ? (
              <div className="empty">No nominations yet — suggest the first book.</div>
            ) : (
              <motion.ul className="plain-list" layout>
                {sortedNominations.map((n) => (
                  <NominationRow
                    key={n.id}
                    n={n}
                    voting
                    myVote={data.myVote === n.id}
                    canVeto={!data.myVetoUsed && n.vetoed_by == null}
                    isOwner={isOwner}
                    onVote={() => vote(n.id)}
                    onUnvote={unvote}
                    onVeto={() => setVetoTarget(n)}
                    onRemove={() => setRemoveTarget(n)}
                  />
                ))}
              </motion.ul>
            )}

            {data.myVote != null && (
              <div className="muted club-myvote-note">
                You have one vote — tapping another book moves it.{" "}
                <button type="button" className="link" onClick={unvote}>
                  Remove my vote
                </button>
              </div>
            )}
            <div className="muted club-myvote-note">
              {data.myVetoUsed
                ? "You've used your veto for this vote."
                : "You also get one veto — it strikes a book for everyone and can't be undone."}
            </div>
          </>
        )}
      </section>

      <section className="club-section">
        <h3 className="section-title">Members ({data.members.filter((m) => m.status === "accepted").length})</h3>
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

      {showRunoff && (
        <ConfirmDialog
          title={tiedNominations.length > 1 ? "It's a tie" : "No majority yet"}
          confirmLabel="Start runoff"
          busyLabel="Starting…"
          busy={runoffBusy}
          onConfirm={startRunoff}
          onCancel={() => setShowRunoff(false)}
        >
          {tiedNominations.length > 1
            ? `${tiedNominations.map((n) => `"${n.title}"`).join(" and ")} are tied at ${topVotes} ${topVotes === 1 ? "vote" : "votes"} each.`
            : `"${tiedNominations[0]?.title}" leads with ${topVotes} of ${totalVotes} votes — short of a majority.`}{" "}
          Start a runoff between {runoffNominations.map((n) => `"${n.title}"`).join(" and ")}? The other nominations are
          dropped, votes reset, and everyone votes again between just these books.
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
          Veto "{vetoTarget.title}"? It's struck from this vote and any votes for it are released. You only get one veto
          per vote, and this can't be undone.
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
          Remove "{removeTarget.title}" from the vote? It leaves the list entirely — any votes for it are released, and
          it can be nominated again like new. For accidents; use your veto to block a book you oppose.
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
                        {h.mine === "reading" ? "Reading" : h.mine === "wishlist" ? "Wishlist" : "Read"}
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
  myVote,
  canVeto,
  isOwner,
  onVote,
  onUnvote,
  onVeto,
  onRemove,
}: {
  n: ClubNomination;
  voting: boolean;
  myVote: boolean;
  canVeto: boolean;
  isOwner: boolean;
  onVote: () => void;
  onUnvote: () => void;
  onVeto: () => void;
  onRemove: () => void;
}) {
  const vetoed = n.vetoed_by != null;
  return (
    <motion.li
      layout
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className={`book-row club-book-row${myVote ? " my-vote" : ""}${vetoed ? " vetoed" : ""}`}
    >
      <Cover url={n.cover_url} />
      <div className="info">
        <div className="title">
          {n.title}
          {myVote && <span className="badge accent">Your vote</span>}
          {vetoed && <span className="badge danger">Vetoed by {n.vetoedBy ?? "a member"}</span>}
        </div>
        <Byline author={n.author} year={n.first_publish_year} extra={`nominated by ${n.nominatedBy}`} />
      </div>
      <div className="actions">
        {!vetoed && voting && (
          <>
            <button
              type="button"
              className={`btn-secondary vote-btn${myVote ? " on" : ""}`}
              onClick={myVote ? onUnvote : onVote}
              title={myVote ? "Remove your vote" : "Vote for this book"}
              aria-label={`Vote for ${n.title}, ${n.votes} vote${n.votes === 1 ? "" : "s"}`}
              aria-pressed={myVote}
            >
              <IconThumbsUp />
              {n.votes}
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
        {isOwner && (
          <button
            type="button"
            className="icon-btn remove"
            onClick={onRemove}
            title={vetoed ? "Remove this entry entirely" : "Remove from vote (accidental nomination)"}
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
  onStarted,
}: {
  pick: NonNullable<ClubDetailData["currentPick"]>;
  onStarted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function startReading() {
    setBusy(true);
    setError("");
    try {
      await api("/api/me/reading", {
        method: "POST",
        body: JSON.stringify({ book_id: pick.book_id }),
      });
      await onStarted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

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
          <div className="actions">
            {pick.isReading ? (
              <button type="button" disabled>
                <IconCheck /> Reading
              </button>
            ) : (
              <button type="button" onClick={startReading} disabled={busy}>
                {busy ? "Adding…" : "Start reading"}
              </button>
            )}
          </div>
          {error && <div className="error-text">{error}</div>}
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
