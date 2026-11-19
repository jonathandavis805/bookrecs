import { useEffect, useState } from "react";
import { api, User } from "../api";

interface AccountProps {
  user: User;
  onChangePassword: () => void;
}

export default function Account({ user, onChangePassword }: AccountProps) {
  const [discoverable, setDiscoverable] = useState(Boolean(user.discoverable ?? true));
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    api<{ discoverable: boolean }>("/api/me/privacy")
      .then((d) => setDiscoverable(d.discoverable))
      .catch((e: any) => setError(e.message));
  }, []);

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
    </div>
  );
}
