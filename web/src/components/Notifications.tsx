import { useCallback, useEffect, useState } from "react";
import { api, type NotificationItem } from "../api";
import { Modal } from "./ui/Modal";

interface NotificationsProps {
  refreshKey: number;
  onFriendRequestsChanged: () => void;
  onClose: () => void;
  onCountChange: (count: number) => void;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
}

const MAX_DETAILS = 5;

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function Notifications({
  refreshKey,
  onFriendRequestsChanged,
  onClose,
  onCountChange,
}: NotificationsProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Shows the list as it was on open (so new items stay highlighted), then marks
  // everything that doesn't need a response as read; the badge drops to just those.
  const load = useCallback(async () => {
    try {
      const data = await api<NotificationsResponse>("/api/notifications");
      setNotifications(data.notifications);
      const seen = await api<NotificationsResponse>("/api/notifications/seen", { method: "POST" });
      onCountChange(seen.unreadCount);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a refetch trigger
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function respond(label: string, path: string, body?: unknown, refreshOthers = false) {
    try {
      await api(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
      if (refreshOthers) onFriendRequestsChanged();
      await load();
    } catch (err) {
      console.error(`Failed to ${label}:`, err);
    }
  }

  function openClub(clubId: number) {
    window.location.hash = `#/club/${clubId}`;
    onClose();
  }

  function actions(n: NotificationItem) {
    const data = n.data ?? {};
    if (n.type === "friend_request" && data.requestId) {
      const path = `/api/friends/requests/${data.requestId}`;
      return [
        ["Decline", () => respond("decline friend request", `${path}/decline`, undefined, true)],
        ["Accept", () => respond("accept friend request", `${path}/accept`, undefined, true)],
      ] as const;
    }
    if (n.type === "club_invite" && data.clubId) {
      const path = `/api/clubs/${data.clubId}/respond`;
      return [
        ["Decline", () => respond("decline club invite", path, { accept: false }, true)],
        ["Join", () => respond("join club", path, { accept: true }, true)],
      ] as const;
    }
    const userId = data.userId ?? data.id;
    if (n.type === "new_user_signup" && userId) {
      return [
        ["Reject", () => respond("reject user", `/api/users/${userId}/reject`)],
        ["Approve", () => respond("approve user", `/api/users/${userId}/approve`)],
      ] as const;
    }
    return [];
  }

  function renderItem(n: NotificationItem) {
    const [secondary, primary] = actions(n);
    const extra = n.details.length - MAX_DETAILS;
    return (
      <li key={n.key} className={`notification-item${!n.read ? " unread" : ""}`}>
        <div className="notification-content">
          <div className="notification-message">{n.message}</div>
          {n.details.length > 0 && (
            <ul className="notification-details">
              {n.details.slice(0, MAX_DETAILS).map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: details are static strings that can repeat
                <li key={i}>{d}</li>
              ))}
              {extra > 0 && <li className="muted">and {extra} more</li>}
            </ul>
          )}
          <div className="notification-time">{formatTime(n.created_at)}</div>
          {n.actionable && primary && secondary && (
            <div className="notification-actions">
              <button type="button" className="btn-secondary btn-sm" onClick={secondary[1]}>
                {secondary[0]}
              </button>
              <button type="button" className="btn-primary btn-sm" onClick={primary[1]}>
                {primary[0]}
              </button>
            </div>
          )}
          {!n.actionable && n.data?.clubId && n.type.startsWith("club") && (
            <button type="button" className="link notification-link" onClick={() => openClub(n.data?.clubId ?? 0)}>
              View club
            </button>
          )}
        </div>
      </li>
    );
  }

  const sections: [string, NotificationItem[]][] = [
    ["Needs your response", notifications.filter((n) => n.actionable)],
    ["New", notifications.filter((n) => !n.actionable && !n.read)],
    ["Earlier", notifications.filter((n) => !n.actionable && n.read)],
  ];

  return (
    <Modal title="Notifications" onClose={onClose}>
      <div className="notifications-content">
        {loading ? (
          <div className="loading">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="loading">You're all caught up.</div>
        ) : (
          sections
            .filter(([, items]) => items.length > 0)
            .map(([title, items]) => (
              <section key={title} className="notification-section">
                <h3 className="notification-section-title">{title}</h3>
                <ul className="notifications-list">{items.map(renderItem)}</ul>
              </section>
            ))
        )}
      </div>
    </Modal>
  );
}
