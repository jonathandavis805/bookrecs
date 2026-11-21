import { useCallback, useEffect, useState } from "react";
import { api, type ClubInvite, type ClubSummary, errorMessage } from "../api";
import { IconChevronRight } from "./ui/icons";

export default function Clubs({ refreshKey, onClubsChanged }: { refreshKey: number; onClubsChanged: () => void }) {
  const [clubs, setClubs] = useState<ClubSummary[]>([]);
  const [invites, setInvites] = useState<ClubInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ clubs: ClubSummary[]; invites: ClubInvite[] }>("/api/clubs");
      setClubs(d.clubs);
      setInvites(d.invites);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a refetch trigger
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function respond(clubId: number, accept: boolean) {
    setError("");
    try {
      const d = await api<{ clubs: ClubSummary[]; invites: ClubInvite[] }>(`/api/clubs/${clubId}/respond`, {
        method: "POST",
        body: JSON.stringify({ accept }),
      });
      setClubs(d.clubs);
      setInvites(d.invites);
      // The backend marked the invite notification as read — refresh the
      // bell count (and any other panels) right away instead of waiting
      // for the 30s poll.
      onClubsChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function openClub(clubId: number) {
    window.location.hash = `#/club/${clubId}`;
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Clubs</h2>
        <p className="muted">Read together: nominate books, vote, and pick your next read.</p>
        {!showCreate && (
          <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
            Start a club
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {invites.length > 0 && (
        <section>
          <h3 className="section-title">Club invites</h3>
          <ul className="plain-list">
            {invites.map((inv) => (
              <li key={inv.clubId} className="row club-invite-row">
                <div className="info">
                  <div className="title">{inv.name}</div>
                  <div className="author">Invited by {inv.inviter ? `${inv.inviter}` : "a friend"}</div>
                </div>
                <div className="actions">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => respond(inv.clubId, false)}>
                    Decline
                  </button>
                  <button type="button" className="btn-primary btn-sm" onClick={() => respond(inv.clubId, true)}>
                    Accept
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : clubs.length === 0 && invites.length === 0 ? (
        <div className="empty">
          <p>No clubs yet.</p>
          <p className="muted">Start one with a few friends.</p>
        </div>
      ) : (
        <ul className="plain-list club-list">
          {clubs.map((c) => (
            <li key={c.id}>
              <a className="club-card" href={`#/club/${c.id}`}>
                <div className="club-card-main">
                  <div className="title">
                    {c.name}
                    {c.role === "owner" && <span className="badge">Owner</span>}
                  </div>
                  {c.description && <div className="author">{c.description}</div>}
                  <div className="author">
                    {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                    {c.invitedCount > 0 && ` · ${c.invitedCount} invited`}
                    {c.voting_open === 1
                      ? c.nominationCount > 0
                        ? ` · Voting open · ${c.nominationCount} nominated`
                        : " · Voting open · no nominations yet"
                      : c.nominations_open === 1
                        ? c.nominationCount > 0
                          ? ` · Nominating · ${c.nominationCount} nominated`
                          : " · Nominating · no nominations yet"
                        : ""}
                  </div>
                  {c.currentPick && (
                    <div className="club-current-pick">
                      <span className="muted">Now reading:</span> {c.currentPick.title}
                    </div>
                  )}
                </div>
                <IconChevronRight size={20} className="club-chevron" />
              </a>
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateClub
          onDone={(clubId) => {
            setShowCreate(false);
            if (clubId) openClub(clubId);
            else load();
          }}
        />
      )}
    </div>
  );
}

function CreateClub({ onDone }: { onDone: (clubId: number | null) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [friends, setFriends] = useState<{ user_id: number; username: string }[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ friends: { user_id: number; username: string }[] }>("/api/friends")
      .then((d) => setFriends(d.friends))
      .catch(() => setFriends([]));
  }, []);

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const d = await api<{ club: { id: number }; invited: string[]; skipped: string[] }>("/api/clubs", {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          usernames: friends.filter((f) => picked.has(f.user_id)).map((f) => f.username),
        }),
      });
      onDone(d.club.id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <section className="form-section">
      <h3 className="section-title">Start a club</h3>
      {error && <div className="error">{error}</div>}
      <form className="card form" onSubmit={submit}>
        <label className="field">
          Club name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Thursday Night Reads"
            maxLength={80}
            required
            autoFocus
          />
        </label>
        <label className="field">
          Description (optional)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What the club is about…"
            rows={2}
            maxLength={500}
          />
        </label>
        {friends.length > 0 ? (
          <div className="field">
            <span className="field-label">Invite friends</span>
            <div className="chip-picker">
              {friends.map((f) => (
                <button
                  type="button"
                  key={f.user_id}
                  className={`chip${picked.has(f.user_id) ? " picked" : ""}`}
                  onClick={() => toggle(f.user_id)}
                >
                  {f.username}
                </button>
              ))}
            </div>
            <span className="muted">
              {picked.size} of {friends.length} selected
            </span>
          </div>
        ) : (
          <div className="muted">Add some friends first — clubs are invite-only among friends.</div>
        )}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create club"}
          </button>
        </div>
      </form>
    </section>
  );
}
