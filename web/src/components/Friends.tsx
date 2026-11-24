import { useEffect, useState } from "react";
import { api, errorMessage, type ReadingItem } from "../api";
import { useData } from "../useData";
import { Cover } from "./ui/Book";
import { ConfirmDialog } from "./ui/Modal";
import { RemoveButton } from "./ui/RemoveButton";

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
}

export default function Friends({ refreshKey, onFriendRequestsChanged }: FriendsProps) {
  const { data, error: loadError, reload: reloadFriends } = useData<{ friends: Friend[] }>("/api/friends");
  const { data: requests, reload: reloadRequests } = useData<{ incoming: Request[]; outgoing: Request[] }>(
    "/api/friends/requests",
  );
  const friends = data?.friends ?? [];
  const incoming = requests?.incoming ?? [];
  const outgoing = requests?.outgoing ?? [];
  const [removing, setRemoving] = useState<Friend | null>(null);
  const [addInput, setAddInput] = useState("");
  const [searchResults, setSearchResults] = useState<SearchableUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = () => Promise.all([reloadFriends(), reloadRequests()]);

  // Requests answered from the notifications panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a refetch trigger
  useEffect(() => {
    if (refreshKey > 0) load();
  }, [refreshKey]);

  useEffect(() => {
    const q = addInput.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let superseded = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api<{ users: SearchableUser[] }>(`/api/users/discover?q=${encodeURIComponent(q)}`)
        .then((d) => !superseded && setSearchResults(d.users))
        .catch(() => !superseded && setSearchResults([]))
        .finally(() => !superseded && setSearching(false));
    }, 250);
    return () => {
      superseded = true;
      clearTimeout(timer);
    };
  }, [addInput]);

  async function addFriend(usernameOrEmail: string) {
    setError("");
    setInfo("");
    try {
      const r = await api<{ username?: string; autoAccepted?: boolean }>("/api/friends/requests", {
        method: "POST",
        body: JSON.stringify({ usernameOrEmail }),
      });
      setInfo(r.autoAccepted ? `You are now friends with ${r.username}!` : `Request sent to ${r.username}.`);
      setAddInput("");
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
      {(error || loadError) && <div className="error">{error || loadError}</div>}
      {info && <div className="success">{info}</div>}

      <section>
        <form
          className="search-bar"
          onSubmit={(e) => {
            e.preventDefault();
            if (addInput.trim()) addFriend(addInput.trim());
          }}
        >
          <input
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="Find people by name, email, or username…"
          />
          {addInput.trim() && (
            <button type="submit" className="btn-primary">
              Add friend
            </button>
          )}
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
                      <button type="button" className="btn-secondary btn-sm" onClick={() => addFriend(u.username)}>
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
          <h3 className="section-title">Friends</h3>
          {data === null ? (
            <div className="loading">Loading…</div>
          ) : friends.length === 0 ? (
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
                    <RemoveButton title={`Remove ${f.username}`} onClick={() => setRemoving(f)} />
                  </div>
                  {f.reading.length > 0 && (
                    <div className="friend-reading">
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

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.username}?`}
          confirmLabel="Remove friend"
          danger
          onConfirm={() => {
            unfriend(removing.user_id);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        >
          You'll stop seeing each other's books.
        </ConfirmDialog>
      )}
    </div>
  );
}
