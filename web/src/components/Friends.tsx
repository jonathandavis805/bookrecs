import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type ReadingItem } from "../api";
import { Cover } from "./ui/Book";

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
  refreshKey: number;
  onFriendRequestsChanged: () => void;
  onOpenProfile: (username: string) => void;
}

export default function Friends({ refreshKey, onFriendRequestsChanged, onOpenProfile }: FriendsProps) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<Request[]>([]);
  const [outgoing, setOutgoing] = useState<Request[]>([]);
  const [addInput, setAddInput] = useState("");
  const [searchResults, setSearchResults] = useState<SearchableUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([
        api<{ friends: Friend[] }>("/api/friends"),
        api<{ incoming: Request[]; outgoing: Request[] }>("/api/friends/requests"),
      ]);
      setFriends(f.friends);
      setIncoming(r.incoming);
      setOutgoing(r.outgoing);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a refetch trigger
  useEffect(() => {
    load();
  }, [load, refreshKey]);

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
    } catch (err) {
      setError(errorMessage(err));
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
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function respond(id: number, action: "accept" | "decline") {
    try {
      await api(`/api/friends/requests/${id}/${action}`, { method: "POST" });
      await load();
      onFriendRequestsChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function unfriend(id: number) {
    try {
      await api(`/api/friends/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const friendIds = new Set(friends.map((f) => f.user_id));
  const outgoingIds = new Set(outgoing.map((r) => r.user_id));

  return (
    <div className="page">
      <div className="page-head">
        <h2>Friends</h2>
      </div>

      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}

      <section>
        <p className="muted">Search by name, email, or username to find people and add them as friends.</p>

        <form className="search-bar" onSubmit={addFriend}>
          <input
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="Search by name, email, or username…"
            autoFocus
          />
          <button type="submit" className="btn-primary">
            Add friend
          </button>
        </form>

        {searching && <div className="muted">Searching…</div>}

        {searchResults.length > 0 && (
          <ul className="plain-list">
            {searchResults.map((u) => {
              const isFriend = friendIds.has(u.id);
              const isPending = outgoingIds.has(u.id);
              return (
                <li key={u.id} className="row">
                  <a className="user-link" href={`#/u/${encodeURIComponent(u.username)}`}>
                    {u.username}
                  </a>
                  <div className="actions">
                    {isFriend ? (
                      <span className="muted">Already friends</span>
                    ) : isPending ? (
                      <span className="muted">Request sent</span>
                    ) : (
                      <button type="button" onClick={() => addFriendByUsername(u.username)}>
                        Add friend
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {addInput.trim() && !searching && searchResults.length === 0 && <p className="muted">No users found.</p>}

        {incoming.length > 0 && (
          <section>
            <h3 className="section-title">Requests to you</h3>
            <ul className="plain-list">
              {incoming.map((r) => (
                <li key={r.id} className="row">
                  <span className="username">{r.username}</span>
                  <div className="actions">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => respond(r.id, "decline")}>
                      Decline
                    </button>
                    <button type="button" className="btn-primary btn-sm" onClick={() => respond(r.id, "accept")}>
                      Accept
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {outgoing.length > 0 && (
          <section>
            <h3 className="section-title">Sent (pending)</h3>
            <ul className="plain-list">
              {outgoing.map((r) => (
                <li key={r.id} className="row">
                  <span className="username">{r.username}</span>
                  <span className="muted">pending</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="section-title">Your friends</h3>
          {friends.length === 0 ? (
            <div className="empty">
              <p className="muted">No friends yet — add someone above.</p>
            </div>
          ) : (
            <ul className="plain-list">
              {friends.map((f) => (
                <li key={f.user_id} className="row friend-row">
                  <div className="friend-row-head">
                    <a className="user-link" href={`#/u/${encodeURIComponent(f.username)}`}>
                      {f.username}
                    </a>
                    <div className="actions">
                      <button type="button" onClick={() => onOpenProfile(f.username)}>
                        View profile
                      </button>
                      <button type="button" className="danger" onClick={() => unfriend(f.user_id)}>
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
                          <Cover url={b.cover_url} size="sm" />
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
