import { useEffect, useState } from "react";
import { api, User } from "../api";

interface Friend {
  user_id: number;
  username: string;
}
interface Request {
  id: number;
  user_id: number;
  username: string;
}

interface FriendsProps {
  user: User;
  onOpenProfile: (username: string) => void;
  onChangePassword: () => void;
}

export default function Friends({ user, onOpenProfile, onChangePassword }: FriendsProps) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<Request[]>([]);
  const [outgoing, setOutgoing] = useState<Request[]>([]);
  const [addInput, setAddInput] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function load() {
    try {
      const [f, r] = await Promise.all([
        api<{ friends: Friend[] }>("/api/friends"),
        api<{ incoming: Request[]; outgoing: Request[] }>("/api/friends/requests"),
      ]);
      setFriends(f.friends);
      setIncoming(r.incoming);
      setOutgoing(r.outgoing);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function respond(id: number, action: "accept" | "decline") {
    try {
      await api(`/api/friends/requests/${id}/${action}`, { method: "POST" });
      await load();
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
            <button className="btn-link" onClick={() => onChangePassword()}>
              Change Password
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3>Friends</h3>
        <p className="muted">Add people by username or email to see what they've read.</p>

        <form className="search-bar" onSubmit={addFriend}>
          <input
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="Add by username or email…"
          />
          <button type="submit">Add friend</button>
        </form>

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
                <li key={f.user_id} className="row">
                  <button className="friend-link" onClick={() => onOpenProfile(f.username)}>
                    @{f.username}
                  </button>
                  <div className="actions">
                    <button onClick={() => onOpenProfile(f.username)}>View profile</button>
                    <button className="danger" onClick={() => unfriend(f.user_id)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </div>
  );
}
