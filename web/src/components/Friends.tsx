import { useEffect, useRef, useState } from "react";
import { api, User, ReadingItem } from "../api";

interface Friend {
  user_id: number;
  username: string;
  reading: ReadingItem[];
}
interface Request {
  id: number;
  user_id: number;
  username: string;
}
interface SearchableUser {
  id: number;
  username: string;
}

interface FriendsProps {
  user: User;
  refreshKey: number;
  onFriendRequestsChanged: () => void;
  onOpenProfile: (username: string) => void;
  onChangePassword: () => void;
}

export default function Friends({ user, refreshKey, onFriendRequestsChanged, onOpenProfile, onChangePassword }: FriendsProps) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<Request[]>([]);
  const [outgoing, setOutgoing] = useState<Request[]>([]);
  const [addInput, setAddInput] = useState("");
  const [searchResults, setSearchResults] = useState<SearchableUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [discoverable, setDiscoverable] = useState(Boolean(user.discoverable ?? true));
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    try {
      const [f, r, privacy] = await Promise.all([
        api<{ friends: Friend[] }>("/api/friends"),
        api<{ incoming: Request[]; outgoing: Request[] }>("/api/friends/requests"),
        api<{ discoverable: boolean }>("/api/me/privacy"),
      ]);
      setFriends(f.friends);
      setIncoming(r.incoming);
      setOutgoing(r.outgoing);
      setDiscoverable(privacy.discoverable);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, [refreshKey]);

  useEffect(() => {
    const q = addInput.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      api<{ users: SearchableUser[] }>(`/api/users/discover?q=${encodeURIComponent(q)}`)
        .then((d) => setSearchResults(d.users))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [addInput]);

  async function toggleDiscoverable() {
    const next = !discoverable;
    setDiscoverable(next);
    try {
      await api("/api/me/privacy", {
        method: "POST",
        body: JSON.stringify({ discoverable: next }),
      });
      setInfo(next ? "Your profile is now visible in Discover." : "Your profile is now hidden from Discover.");
    } catch (e: any) {
      setDiscoverable(!next);
      setError(e.message);
    }
  }

  async function addFriend(e: React.FormEvent) {
    e.preventDefault();
    if (!addInput.trim()) return;
    setError("");
    setInfo("");
    try {
      const r = await api<{ username?: string; autoAccepted?: boolean }>("/api/friends/requests", {
        method: "POST",
        body: JSON.stringify({ usernameOrEmail: addInput.trim() }),
      });
      setInfo(r.autoAccepted ? `You are now friends with ${r.username}!` : `Request sent to ${r.username}.`);
      setAddInput("");
      await load();
      onFriendRequestsChanged();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function addFriendByUsername(username: string) {
    setError("");
    setInfo("");
    try {
      const r = await api<{ username?: string; autoAccepted?: boolean }>("/api/friends/requests", {
        method: "POST",
        body: JSON.stringify({ usernameOrEmail: username }),
      });
      setInfo(r.autoAccepted ? `You are now friends with ${r.username}!` : `Request sent to ${r.username}.`);
      await load();
      onFriendRequestsChanged();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function respond(id: number, action: "accept" | "decline") {
    try {
      await api(`/api/friends/requests/${id}/${action}`, { method: "POST" });
      await load();
      onFriendRequestsChanged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function unfriend(id: number) {
    try {
      await api(`/api/friends/${id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const friendIds = new Set(friends.map((f) => f.user_id));
  const outgoingIds = new Set(outgoing.map((r) => r.user_id));

  return (
    <div className="page">
      <div className="page-head">
        <h2>My Account</h2>
      </div>

      {error && <div className="error">{error}</div>}
      {info && <div className="info">{info}</div>}

      <section className="account-info">
        <h3>Account Information</h3>
        <div className="account-details">
          <div className="detail-row">
            <span className="detail-label">Username</span>
            <span className="detail-value">@{user.username}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Email</span>
            <span className="detail-value">{user.email}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Private mode</span>
            <div className="detail-value" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button
                type="button"
                role="switch"
                aria-checked={!discoverable}
                className={"switch sm" + (!discoverable ? " on" : "")}
                onClick={toggleDiscoverable}
              >
                <span className="knob" />
              </button>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                {discoverable ? "Off — others can find you" : "On — hidden from discovery"}
              </span>
            </div>
          </div>
          <div className="detail-row">
            <button className="btn-link" onClick={() => onChangePassword()}>
              Change Password
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3>Friends</h3>
        <p className="muted">Search by name, email, or username to find people and add them as friends.</p>

        <form className="search-bar" onSubmit={addFriend}>
          <input
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="Search by name, email, or username…"
            autoFocus
          />
          <button type="submit">Add friend</button>
        </form>

        {searching && <div className="muted" style={{ marginTop: "0.5rem" }}>Searching…</div>}

        {searchResults.length > 0 && (
          <ul className="plain-list" style={{ marginTop: "0.5rem" }}>
            {searchResults.map((u) => {
              const isFriend = friendIds.has(u.id);
              const isPending = outgoingIds.has(u.id);
              return (
                <li key={u.id} className="row">
                  <button className="friend-link" onClick={() => onOpenProfile(u.username)}>
                    @{u.username}
                  </button>
                  <div className="actions">
                    {isFriend ? (
                      <span className="muted">Already friends</span>
                    ) : isPending ? (
                      <span className="muted">Request sent</span>
                    ) : (
                      <button onClick={() => addFriendByUsername(u.username)}>
                        Add friend
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {addInput.trim() && !searching && searchResults.length === 0 && (
          <div className="empty muted" style={{ padding: "0.5rem 0" }}>
            No users found.
          </div>
        )}

        {incoming.length > 0 && (
          <section>
            <h4>Requests to you</h4>
            <ul className="plain-list">
              {incoming.map((r) => (
                <li key={r.id} className="row">
                  <span className="username">@{r.username}</span>
                  <div className="actions">
                    <button onClick={() => respond(r.id, "accept")}>Accept</button>
                    <button className="danger" onClick={() => respond(r.id, "decline")}>
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {outgoing.length > 0 && (
          <section>
            <h4>Sent (pending)</h4>
            <ul className="plain-list">
              {outgoing.map((r) => (
                <li key={r.id} className="row">
                  <span className="username">@{r.username}</span>
                  <span className="muted">pending</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h4>Your friends</h4>
          {friends.length === 0 ? (
            <div className="empty">
              <p className="muted">No friends yet — add someone above.</p>
            </div>
          ) : (
            <ul className="plain-list">
              {friends.map((f) => (
                <li key={f.user_id} className="friend-item">
                  <div className="row">
                    <button className="friend-link" onClick={() => onOpenProfile(f.username)}>
                      @{f.username}
                    </button>
                    <div className="actions">
                      <button onClick={() => onOpenProfile(f.username)}>View profile</button>
                      <button className="danger" onClick={() => unfriend(f.user_id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                  {f.reading.length > 0 && (
                    <div className="friend-reading">
                      <span className="friend-reading-label">Reading</span>
                      {f.reading.map((b) => (
                        <a
                          key={b.book_id}
                          className="friend-reading-book"
                          href={`#/book/${b.book_id}`}
                          title={b.author ? `${b.title} — ${b.author}` : b.title}
                        >
                          {b.cover_url ? (
                            <img className="cover sm" src={b.cover_url} alt="" />
                          ) : (
                            <span className="cover sm no-cover">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v16h12V4H6zm2 3h8v2H8V7zm0 4h8v2H8v-2z" />
                              </svg>
                            </span>
                          )}
                          <span className="friend-reading-title">{b.title}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </div>
  );
}
