import { useEffect, useState } from "react";
import { api, errorMessage, type User } from "../api";
import Appearance from "./Appearance";
import { Switch } from "./ui/Switch";

interface AccountProps {
  user: User;
  onChangePassword: () => void;
}

export default function Account({ user, onChangePassword }: AccountProps) {
  const [discoverable, setDiscoverable] = useState(Boolean(user.discoverable ?? true));
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [token, setToken] = useState("");

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
      setInfo(next ? "Others can now find you in friend search." : "You are now hidden from friend search.");
    } catch (e) {
      setDiscoverable(!next);
      setError(errorMessage(e));
    }
  }

  async function generateToken() {
    try {
      setToken((await api<{ token: string }>("/api/token", { method: "POST" })).token);
    } catch (e) {
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

      <section className="card">
        <h3 className="section-title">API token</h3>
        <p className="muted">
          Lets the BookRecs MCP server act as you (set it as BOOKRECS_TOKEN). Generating a new token replaces the old
          one.
        </p>
        {token ? (
          <code className="token">{token}</code>
        ) : (
          <button type="button" className="btn-secondary token-button" onClick={generateToken}>
            Generate token
          </button>
        )}
      </section>

      <Appearance />
    </div>
  );
}
