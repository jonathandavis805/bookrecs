import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, User, ClubDetailData, ClubNomination, SearchHit } from "../api";

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
      <button className="link" onClick={goBackToClubs} title="Back to clubs">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Clubs
      </button>
    </div>
  );
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

  async function load(background = false) {
    try {
      const d = await api<{ club: ClubDetailData }>(`/api/clubs/${clubId}`);
      setData(d.club);
      setError("");
    } catch (e: any) {
      // A background poll shouldn't tear down the page on a transient
      // blip — but losing your membership or the club itself is a real
      // state change worth surfacing immediately.
      const gone = /not a member|haven't joined|Club not found/i.test(e.message ?? "");
      if (!background || gone) {
        setError(e.message);
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }

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
  }, [clubId]);

  if (loading) {
    return (
      <div className="page">
        <BackToClubs />
        <div className="empty">Loading…</div>
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
  const transferCandidates = data.members.filter(
    (m) => m.status === "accepted" && m.role !== "owner"
  );
  const activeNominations = data.nominations.filter((n) => n.vetoed_by == null);
  // A tie at the top (books sharing the lead with at least one vote).
  const topVotes = activeNominations.reduce((m, n) => Math.max(m, n.votes), 0);
  const tiedNominations = topVotes > 0 ? activeNominations.filter((n) => n.votes === topVotes) : [];
  // Live order: most votes first (tied books hold their nomination order —
  // they only move when a count actually changes), vetoed nominations sink
  // to the bottom.
  const sortedNominations = [...activeNominations]
    .sort((a, b) => (b.votes - a.votes) || (a.created_at - b.created_at) || (a.id - b.id))
    .concat(data.nominations.filter((n) => n.vetoed_by != null));

  async function act(fn: () => Promise<any>, message?: string) {
    setError("");
    setInfo("");
    try {
      await fn();
      if (message) setInfo(message);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function vote(nominationId: number) {
    await act(() =>
      api(`/api/clubs/${clubId}/vote`, {
        method: "POST",
        body: JSON.stringify({ nominationId }),
      })
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
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRemoveBusy(false);
    }
  }

  async function closeVote() {
    // A tie at the top needs a runoff — offer it instead of failing.
    if (tiedNominations.length > 1) {
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
      setInfo("Runoff started — votes reset for the tied books.");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunoffBusy(false);
    }
  }

  async function reopenVote() {
    await act(() => api(`/api/clubs/${clubId}/reopen-vote`, { method: "POST" }), "Voting reopened for the next pick.");
  }

  async function removeMember(userId: number) {
    await act(() => api(`/api/clubs/${clubId}/members/${userId}`, { method: "DELETE" }));
  }

  async function leave() {
    setLeaveBusy(true);
    try {
      await api(`/api/clubs/${clubId}/leave`, { method: "POST" });
      window.location.hash = "#/clubs";
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
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
      {info && <div className="info">{info}</div>}

      {data.currentPick && <CurrentPick pick={data.currentPick} />}

      <section className="club-section">
        <h3 className="section-title">
          {data.votingOpen ? "Vote for the next book" : "Voting"}
        </h3>
        {!data.votingOpen && (
          <div className="club-closed-row">
            <span className="muted">
              Voting is closed. The winner is shown above as the current read.
            </span>
            {isOwner && (
              <button className="btn-primary" onClick={reopenVote}>
                Start a new vote
              </button>
            )}
          </div>
        )}

        {data.votingOpen && (
          <>
            {isOwner && (
              <div className="club-owner-actions">
                <button
                  className="btn-primary"
                  onClick={closeVote}
                  disabled={activeNominations.length === 0 || activeNominations.every((n) => n.votes === 0)}
                  title={
                    activeNominations.length === 0
                      ? data.nominations.length > 0
                        ? "Every nomination was vetoed"
                        : "Nominate at least one book first"
                      : tiedNominations.length > 1
                      ? "It's tied — a runoff will resolve it"
                      : activeNominations.every((n) => n.votes === 0)
                      ? "Waiting for votes"
                      : "Most votes wins"
                  }
                >
                  {data.runoff ? "Close runoff &amp; pick winner" : "Close voting &amp; pick winner"}
                </button>
              </div>
            )}

            {data.runoff && (
              <div className="club-runoff-banner">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 5h-2v6l5 3 1-1.7-4-2.3V7z" />
                </svg>
                <span>
                  <strong>Runoff</strong> — {activeNominations.map((n) => `"${n.title}"`).join(" vs ")}.
                  Votes were reset; cast yours again to break the tie.
                </span>
              </div>
            )}

            {!data.runoff ? (
              <NominatePane clubId={clubId} onNominated={load} />
            ) : (
              <div className="muted club-myvote-note">Nominations are paused until the runoff ends.</div>
            )}

            {data.nominations.length === 0 ? (
              <div className="empty">No nominations yet — suggest the first book.</div>
            ) : (
              <motion.ul className="plain-list" layout>
                {sortedNominations.map((n) => (
                  <NominationRow
                    key={n.id}
                    n={n}
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
                <button className="link" onClick={unvote}>
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
        <h3 className="section-title">Members</h3>
        <MembersPane
          data={data}
          userId={user.id}
          isOwner={isOwner}
          onRemove={removeMember}
          onInvited={load}
          onError={setError}
        />
        <div className="club-footer-actions">
          <button className="link danger-link" onClick={requestLeave}>
            Leave this club
          </button>
          {isOwner && (
            <button className="link danger-link" onClick={requestDelete}>
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
              <li key={p.id} className="book-row club-pick-row">
                {p.cover_url ? (
                  <img className="cover sm" src={p.cover_url} alt="" />
                ) : (
                  <span className="cover sm no-cover" />
                )}
                <div className="info">
                  <div className="title">
                    <button className="link book-title-link" onClick={() => (window.location.hash = `#/book/${p.book_id}`)}>
                      {p.title}
                    </button>
                  </div>
                  <div className="author">
                    {p.author || "Unknown author"}
                    {p.first_publish_year ? ` · ${p.first_publish_year}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showMemberLeave && (
        <div className="modal-overlay" onClick={() => setShowMemberLeave(false)}>
          <div className="modal club-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Leave this club</h2>
              <button className="modal-close" onClick={() => setShowMemberLeave(false)}>
                ×
              </button>
            </div>
            <div className="club-modal-body">
              <p className="muted">Leave "{data.club.name}"? You'll need a new invite to rejoin.</p>
              <div className="form-actions">
                <button className="btn-delete" disabled={leaveBusy} onClick={leave}>
                  {leaveBusy ? "Leaving…" : "Leave club"}
                </button>
                <button className="btn-secondary" onClick={() => setShowMemberLeave(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLeave && (
        <div className="modal-overlay" onClick={() => setShowLeave(false)}>
          <div className="modal club-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Leave this club</h2>
              <button className="modal-close" onClick={() => setShowLeave(false)}>
                ×
              </button>
            </div>
            <div className="club-modal-body">
              <p className="muted">
                You own this club. Transfer ownership to one of its members to leave — or delete the club for everyone.
              </p>
              {transferCandidates.length > 0 ? (
                <>
                  <span className="small-label">Transfer ownership to</span>
                  <div className="club-friend-picker">
                    {transferCandidates.map((m) => (
                      <button
                        type="button"
                        key={m.user_id}
                        className={"club-friend-chip" + (transferTarget === m.user_id ? " picked" : "")}
                        onClick={() => setTransferTarget(m.user_id)}
                      >
                        @{m.username}
                      </button>
                    ))}
                  </div>
                  <div className="form-actions">
                    <button
                      className="btn-primary"
                      disabled={transferTarget == null || transferBusy}
                      onClick={transferAndLeave}
                    >
                      {transferBusy ? "Transferring…" : "Transfer ownership & leave"}
                    </button>
                    <button className="btn-secondary" onClick={() => setShowLeave(false)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty">
                  You're the only member. Invite someone first — or delete the club below.
                </div>
              )}
              <div className="club-leave-footer">
                <button
                  className="link danger-link"
                  onClick={() => {
                    setShowLeave(false);
                    requestDelete();
                  }}
                >
                  Delete this club instead
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRunoff && (
        <div className="modal-overlay" onClick={() => setShowRunoff(false)}>
          <div className="modal club-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>It's a tie</h2>
              <button className="modal-close" onClick={() => setShowRunoff(false)}>
                ×
              </button>
            </div>
            <div className="club-modal-body">
              <p className="muted">
                {tiedNominations.map((n) => `"${n.title}"`).join(" and ")} are tied at {topVotes}{" "}
                {topVotes === 1 ? "vote" : "votes"} each. Start a runoff? The other nominations are
                dropped, votes reset, and everyone votes again between just these books.
              </p>
              <div className="form-actions">
                <button className="btn-primary" disabled={runoffBusy} onClick={startRunoff}>
                  {runoffBusy ? "Starting…" : "Start runoff"}
                </button>
                <button className="btn-secondary" onClick={() => setShowRunoff(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {vetoTarget && (
        <div className="modal-overlay" onClick={() => setVetoTarget(null)}>
          <div className="modal club-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Veto this book</h2>
              <button className="modal-close" onClick={() => setVetoTarget(null)}>
                ×
              </button>
            </div>
            <div className="club-modal-body">
              <p className="muted">
                Veto "{vetoTarget.title}"? It's struck from this vote and any votes for it are released.
                You only get one veto per vote, and this can't be undone.
              </p>
              <div className="form-actions">
                <button className="btn-delete" disabled={vetoBusy} onClick={veto}>
                  {vetoBusy ? "Vetoing…" : "Veto book"}
                </button>
                <button className="btn-secondary" onClick={() => setVetoTarget(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <div className="modal-overlay" onClick={() => setRemoveTarget(null)}>
          <div className="modal club-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Remove this book</h2>
              <button className="modal-close" onClick={() => setRemoveTarget(null)}>
                ×
              </button>
            </div>
            <div className="club-modal-body">
              <p className="muted">
                Remove "{removeTarget.title}" from the vote? It leaves the list entirely — any votes for it are
                released, and it can be nominated again like new. For accidents; use your veto to block a book
                you oppose.
              </p>
              <div className="form-actions">
                <button className="btn-delete" disabled={removeBusy} onClick={removeNomination}>
                  {removeBusy ? "Removing…" : "Remove book"}
                </button>
                <button className="btn-secondary" onClick={() => setRemoveTarget(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDelete && (
        <div className="modal-overlay" onClick={() => setShowDelete(false)}>
          <div className="modal club-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete this club</h2>
              <button className="modal-close" onClick={() => setShowDelete(false)}>
                ×
              </button>
            </div>
            <div className="club-modal-body">
              <p className="muted">
                Delete "{data.club.name}"? Nominations, votes, and picks are removed for every member. This can't be undone.
              </p>
              <div className="form-actions">
                <button className="btn-delete" disabled={deleteBusy} onClick={deleteClub}>
                  {deleteBusy ? "Deleting…" : "Delete club"}
                </button>
                <button className="btn-secondary" onClick={() => setShowDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NominatePane({ clubId, onNominated }: { clubId: number; onNominated: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const d = await api<{ results: SearchHit[] }>("/api/books/search?q=" + encodeURIComponent(q.trim()));
        setHits(d.results);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  async function nominate(hit: SearchHit) {
    setStatus((s) => ({ ...s, [hit.key]: "Nominating…" }));
    setError("");
    try {
      await api(`/api/clubs/${clubId}/nominate`, {
        method: "POST",
        body: JSON.stringify({ ol_key: hit.key, year: hit.year }),
      });
      setStatus((s) => ({ ...s, [hit.key]: "Nominated" }));
      setQ("");
      setHits([]);
      onNominated();
    } catch (e: any) {
      setStatus((s) => ({ ...s, [hit.key]: "" }));
      setError(e.message);
    }
  }

  return (
    <div className="club-nominate">
      <div className="search-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a book to nominate…" />
        {searching && <span className="searching-indicator">Searching…</span>}
      </div>
      {error && <div className="error">{error}</div>}
      {hits.length > 0 && (
        <ul className="result-list">
          {hits.map((h) => {
            const st = status[h.key];
            return (
              <li key={h.key} className="book-row">
                {h.coverUrl ? (
                  <img className="cover" src={h.coverUrl} alt="" />
                ) : (
                  <span className="cover no-cover" />
                )}
                <div className="info">
                  <div className="title">{h.title}</div>
                  <div className="author">
                    {h.author || "Unknown author"}
                    {h.year ? ` · ${h.year}` : ""}
                  </div>
                </div>
                <div className="actions">
                  {st === "Nominated" ? (
                    <span className="added">Nominated</span>
                  ) : (
                    <button
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
  myVote,
  canVeto,
  isOwner,
  onVote,
  onUnvote,
  onVeto,
  onRemove,
}: {
  n: ClubNomination;
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
      className={"book-row club-nomination-row" + (myVote ? " my-vote" : "") + (vetoed ? " vetoed" : "")}
    >
      {n.cover_url ? (
        <img className="cover" src={n.cover_url} alt="" />
      ) : (
        <span className="cover no-cover" />
      )}
      <div className="info">
        <div className="title">
          {n.title}
          {myVote && <span className="badge vote-badge">Your vote</span>}
          {vetoed && <span className="badge veto-badge">Vetoed by @{n.vetoedBy ?? "a member"}</span>}
        </div>
        <div className="author">
          {n.author || "Unknown author"}
          {n.first_publish_year ? ` · ${n.first_publish_year}` : ""}
          {` · nominated by @${n.nominatedBy}`}
        </div>
      </div>
      <div className="actions">
        {!vetoed && (
          <>
            <span className="club-vote-count" title={`${n.votes} vote${n.votes === 1 ? "" : "s"}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M2 21h4V9H2v12zM22 10c0-1.1-.9-2-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13 1 7.6 6.4C7.2 6.8 7 7.3 7 7.8V19c0 1.1.9 2 2 2h8.4c.8 0 1.6-.5 1.9-1.3l2.6-6.1c.1-.2.1-.4.1-.6V10z" />
              </svg>
              {n.votes}
            </span>
            <button
              className={myVote ? "secondary" : ""}
              onClick={myVote ? onUnvote : onVote}
            >
              {myVote ? "Unvote" : "Vote"}
            </button>
            {canVeto && (
              <button className="secondary club-veto-btn" onClick={onVeto} title="Strike this book (one veto per vote)">
                Veto
              </button>
            )}
          </>
        )}
        {isOwner && (
          <button
            className="club-nomination-remove"
            onClick={onRemove}
            title={vetoed ? "Remove this entry entirely" : "Remove from vote (accidental nomination)"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
    </motion.li>
  );
}

function CurrentPick({ pick }: { pick: ClubDetailData["currentPick"] }) {
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function startReading() {
    setBusy(true);
    setError("");
    try {
      await api("/api/me/reading", {
        method: "POST",
        body: JSON.stringify({ book_id: pick!.book_id }),
      });
      setStarted(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="club-section club-current">
      <h3 className="section-title">Current read</h3>
      <div className="book-row">
        {pick!.cover_url ? (
          <img className="cover" src={pick!.cover_url} alt="" />
        ) : (
          <span className="cover no-cover" />
        )}
        <div className="info">
          <div className="title">
            <button className="link book-title-link" onClick={() => (window.location.hash = `#/book/${pick!.book_id}`)}>
              {pick!.title}
            </button>
          </div>
          <div className="author">
            {pick!.author || "Unknown author"}
            {pick!.first_publish_year ? ` · ${pick!.first_publish_year}` : ""}
          </div>
          <div className="actions">
            {started ? (
              <span className="added">On your reading list</span>
            ) : (
              <button onClick={startReading} disabled={busy}>
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

  useEffect(() => {
    api<{ friends: { user_id: number; username: string }[] }>("/api/friends")
      .then((d) => setFriends(d.friends))
      .catch(() => setFriends([]));
  }, []);

  const memberIds = new Set(data.members.map((m) => m.user_id));
  const inviteCandidates = friends.filter(
    (f) =>
      !memberIds.has(f.user_id) &&
      (!inviteQ.trim() || f.username.toLowerCase().includes(inviteQ.trim().toLowerCase()))
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
    } catch (e: any) {
      onError(e.message);
    }
  }

  return (
    <div>
      <ul className="club-member-list">
        {data.members.map((m) => (
          <li key={m.user_id} className="club-member">
            <button className="link club-member-name" onClick={() => (window.location.hash = `#/u/${encodeURIComponent(m.username)}`)}>
              @{m.username}
            </button>
            <span className="muted club-member-tags">
              {m.role === "owner" ? "owner" : "member"}
              {m.status === "pending" && " · invited"}
              {m.user_id === userId && " · you"}
            </span>
            {isOwner && m.role !== "owner" && (
              <button
                className="club-member-remove"
                title={m.status === "pending" ? "Cancel invite" : "Remove from club"}
                onClick={() => onRemove(m.user_id)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </li>
        ))}
      </ul>
      {inviteCandidates.length > 0 && (
        <div className="club-invite-box">
          <span className="small-label">Invite a friend</span>
          <input
            value={inviteQ}
            onChange={(e) => setInviteQ(e.target.value)}
            placeholder="Filter your friends…"
          />
          <div className="club-friend-picker">
            {inviteCandidates.map((f) => (
              <button key={f.user_id} type="button" className="club-friend-chip" onClick={() => invite(f.username)}>
                @{f.username}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
