import { useEffect, useState } from "react";
import { api, errorMessage, type User } from "../api";
import { Switch } from "./ui/Switch";

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
      .catch((e) => setError(errorMessage(e)));
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
    } catch (e) {
      setDiscoverable(!next);
      setError(errorMessage(e));
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>My Account</h2>
      </div>

      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}

      <section className="card">
        <h3 className="section-title">Account information</h3>
        <div className="account-details">
          <div className="detail-row">
            <span className="detail-label">Username</span>
            <span className="detail-value">{user.username}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Email</span>
            <span className="detail-value">{user.email}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Private mode</span>
            <div className="detail-value toggle-row">
              <Switch checked={!discoverable} onChange={toggleDiscoverable} label="Private mode" />
              <span className="muted">{discoverable ? "Off — others can find you" : "On — hidden from discovery"}</span>
            </div>
          </div>
          <div className="detail-row">
            <button type="button" className="link" onClick={() => onChangePassword()}>
              Change password
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
