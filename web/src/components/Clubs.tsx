import { useEffect, useState } from "react";
import { api, ClubSummary, ClubInvite, User } from "../api";

export default function Clubs({ user }: { user: User }) {
  const [clubs, setClubs] = useState<ClubSummary[]>([]);
  const [invites, setInvites] = useState<ClubInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    try {
      const d = await api<{ clubs: ClubSummary[]; invites: ClubInvite[] }>("/api/clubs");
      setClubs(d.clubs);
      setInvites(d.invites);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function respond(clubId: number, accept: boolean) {
    setError("");
    try {
      const d = await api<{ clubs: ClubSummary[]; invites: ClubInvite[] }>(`/api/clubs/${clubId}/respond`, {
        method: "POST",
        body: JSON.stringify({ accept }),
      });
      setClubs(d.clubs);
      setInvites(d.invites);
    } catch (e: any) {
      setError(e.message);
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
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            Start a club
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {invites.length > 0 && (
        <section className="club-invites">
          <h3 className="section-title">Club invites</h3>
          <ul className="plain-list">
            {invites.map((inv) => (
              <li key={inv.clubId} className="club-invite-row">
                <div className="info">
                  <div className="title">{inv.name}</div>
                  <div className="author">
                    Invited by {inv.inviter ? `@${inv.inviter}` : "a friend"}
                  </div>
                </div>
                <div className="actions">
                  <button className="btn-small btn-success" onClick={() => respond(inv.clubId, true)}>
                    Accept
                  </button>
                  <button className="btn-small btn-danger" onClick={() => respond(inv.clubId, false)}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : clubs.length === 0 && invites.length === 0 ? (
        <div className="empty">
          <p>No clubs yet.</p>
          <p className="muted">Start one with a few friends.</p>
        </div>
      ) : (
        <ul className="plain-list club-list">
          {clubs.map((c) => (
            <li key={c.id} className="club-card" onClick={() => openClub(c.id)}>
              <div className="club-card-main">
                <div className="title">
                  {c.name}
                  {c.role === "owner" && <span className="badge owner-badge">Owner</span>}
                </div>
                {c.description && <div className="author">{c.description}</div>}
                <div className="author">
                  {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                  {c.voting_open === 1
                    ? c.nominationCount > 0
                      ? ` · Voting open · ${c.nominationCount} nominated`
                      : " · Voting open · no nominations yet"
                    : ""}
                </div>
                {c.currentPick && (
                  <div className="club-current-pick">
                    <span className="muted">Now reading:</span> {c.currentPick.title}
                  </div>
                )}
              </div>
              <svg
                className="club-chevron"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateClub
          user={user}
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

function CreateClub({ user, onDone }: { user: User; onDone: (clubId: number | null) => void }) {
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
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <section className="manual-section">
      <h3>Start a club</h3>
      {error && <div className="error">{error}</div>}
      <form className="manual-form" onSubmit={submit}>
        <label>
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
        <label>
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
          <div className="form-field">
            <span className="small-label">Invite friends</span>
            <div className="club-friend-picker">
              {friends.map((f) => (
                <button
                  type="button"
                  key={f.user_id}
                  className={"club-friend-chip" + (picked.has(f.user_id) ? " picked" : "")}
                  onClick={() => toggle(f.user_id)}
                >
                  @{f.username}
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
