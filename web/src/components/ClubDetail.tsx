import { useEffect, useState } from "react";
import { api, User, ClubDetailData, ClubNomination, SearchHit } from "../api";

export default function ClubDetail({ user, clubId }: { user: User; clubId: number }) {
  const [data, setData] = useState<ClubDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function load() {
    try {
      const d = await api<{ club: ClubDetailData }>(`/api/clubs/${clubId}`);
      setData(d.club);
      setError("");
    } catch (e: any) {
      setError(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [clubId]);

  if (loading) return <div className="page"><div className="centered">Loading…</div></div>;

  if (!data) {
    return (
      <div className="page">
        <div className="page-head">
          <h2>Club</h2>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="link" onClick={() => (window.location.hash = "#/clubs")}>
          Back to clubs
        </button>
      </div>
    );
  }

  const isOwner = data.myRole === "owner";

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

  async function closeVote() {
    await act(() => api(`/api/clubs/${clubId}/close-vote`, { method: "POST" }), "Vote closed — winner picked.");
  }

  async function reopenVote() {
    await act(() => api(`/api/clubs/${clubId}/reopen-vote`, { method: "POST" }), "Voting reopened for the next pick.");
  }

  async function removeMember(userId: number) {
    await act(() => api(`/api/clubs/${clubId}/members/${userId}`, { method: "DELETE" }));
  }

  async function leave() {
    try {
      await api(`/api/clubs/${clubId}/leave`, { method: "POST" });
      window.location.hash = "#/clubs";
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteClub() {
    if (!window.confirm(`Delete "${data!.club.name}"? Nominations, votes, and picks are removed for everyone.`)) return;
    try {
      await api(`/api/clubs/${clubId}`, { method: "DELETE" });
      window.location.hash = "#/clubs";
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <button className="link" onClick={() => (window.location.hash = "#/clubs")}>
          Clubs
        </button>
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
                  disabled={data.nominations.length === 0 || data.nominations.every((n) => n.votes === 0)}
                  title={
                    data.nominations.length === 0
                      ? "Nominate at least one book first"
                      : data.nominations.every((n) => n.votes === 0)
                      ? "Waiting for votes"
                      : "Most votes wins"
                  }
                >
                  Close voting &amp; pick winner
                </button>
              </div>
            )}

            <NominatePane clubId={clubId} onNominated={load} />

            {data.nominations.length === 0 ? (
              <div className="empty">No nominations yet — suggest the first book.</div>
            ) : (
              <ul className="plain-list">
                {data.nominations.map((n) => (
                  <NominationRow
                    key={n.id}
                    n={n}
                    myVote={data.myVote === n.id}
                    onVote={() => vote(n.id)}
                    onUnvote={unvote}
                  />
                ))}
              </ul>
            )}

            {data.myVote != null && (
              <div className="muted club-myvote-note">
                You have one vote — tapping another book moves it.{" "}
                <button className="link" onClick={unvote}>
                  Remove my vote
                </button>
              </div>
            )}
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
          {isOwner ? (
            <button className="link danger-link" onClick={deleteClub}>
              Delete this club
            </button>
          ) : (
            <button className="link danger-link" onClick={leave}>
              Leave this club
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
  onVote,
  onUnvote,
}: {
  n: ClubNomination;
  myVote: boolean;
  onVote: () => void;
  onUnvote: () => void;
}) {
  return (
    <li className={"book-row club-nomination-row" + (myVote ? " my-vote" : "")}>
      {n.cover_url ? (
        <img className="cover" src={n.cover_url} alt="" />
      ) : (
        <span className="cover no-cover" />
      )}
      <div className="info">
        <div className="title">
          {n.title}
          {myVote && <span className="badge vote-badge">Your vote</span>}
        </div>
        <div className="author">
          {n.author || "Unknown author"}
          {n.first_publish_year ? ` · ${n.first_publish_year}` : ""}
          {` · nominated by @${n.nominatedBy}`}
        </div>
      </div>
      <div className="actions">
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
      </div>
    </li>
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
