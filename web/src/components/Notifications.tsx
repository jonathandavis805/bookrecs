import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { IconX } from "./ui/icons";
import { Modal } from "./ui/Modal";

interface Notification {
  id: number;
  type: string;
  message: string;
  data: string | null;
  read: number;
  created_at: number;
}

interface NotificationsProps {
  refreshKey: number;
  onFriendRequestsChanged: () => void;
  onClose: () => void;
  onCountChange: (count: number) => void;
}

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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<{ notifications: Notification[]; unreadCount: number }>("/api/notifications");
      setNotifications(data.notifications);
      onCountChange(data.unreadCount);
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

  async function run(label: string, id: number, request: () => Promise<unknown>, refreshOthers = false) {
    try {
      await request();
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
      onCountChange(notifications.filter((n) => !n.read && n.id !== id).length);
      if (refreshOthers) onFriendRequestsChanged();
    } catch (err) {
      console.error(`Failed to ${label}:`, err);
    }
  }

  async function dismissAll() {
    try {
      await api("/api/notifications/dismiss-all", { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
      onCountChange(0);
    } catch (err) {
      console.error("Failed to dismiss all notifications:", err);
    }
  }

  const post = (path: string, body?: unknown) =>
    api(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  const dismiss = (id: number) => run("dismiss notification", id, () => post(`/api/notifications/${id}/dismiss`));
  const approveUser = (userId: number, id: number) =>
    run("approve user", id, () => post(`/api/users/${userId}/approve`));
  const rejectUser = (userId: number, id: number) => run("reject user", id, () => post(`/api/users/${userId}/reject`));
  const respondToFriendRequest = (requestId: number, action: "accept" | "decline", id: number) =>
    run("respond to friend request", id, () => post(`/api/friends/requests/${requestId}/${action}`), true);
  const respondToClubInvite = (clubId: number, accept: boolean, id: number) =>
    run("respond to club invite", id, () => post(`/api/clubs/${clubId}/respond`, { accept }), true);

  return (
    <Modal title="Notifications" onClose={onClose}>
      <div className="notifications-content">
        {loading ? (
          <div className="loading">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="loading">No notifications yet.</div>
        ) : (
          <>
            {notifications.some((n) => !n.read) && (
              <div className="notifications-actions">
                <button type="button" className="link" onClick={dismissAll}>
                  Dismiss all
                </button>
              </div>
            )}
            <ul className="notifications-list">
              {notifications.map((n) => {
                const data = n.data ? JSON.parse(n.data) : null;
                const isSignupNotification = n.type === "new_user_signup";
                const isFriendRequest = n.type === "friend_request";
                const isClubInvite = n.type === "club_invite";
                const userStatus = data?.status;
                const rejectedAt = data?.rejected_at;
                // Handle both 'id' and 'userId' fields for backward compatibility
                const targetUserId = data?.userId || data?.id;

                let daysRemaining = 0;
                if (userStatus === "rejected" && rejectedAt) {
                  const gracePeriodDays = 7;
                  const daysSinceRejection = Math.floor((Date.now() - rejectedAt * 1000) / 86400000);
                  daysRemaining = Math.max(0, gracePeriodDays - daysSinceRejection);
                }

                return (
                  <li key={n.id} className={`notification-item ${!n.read ? "unread" : ""}`}>
                    <div className="notification-content">
                      <div className="notification-message">
                        {isClubInvite && !n.read && data?.clubId ? (
                          <span>
                            {n.message}{" "}
                            <button
                              type="button"
                              className="link"
                              onClick={() => {
                                window.location.hash = "#/clubs";
                                onClose();
                              }}
                            >
                              View clubs
                            </button>
                          </span>
                        ) : (
                          n.message
                        )}
                      </div>
                      <div className="notification-time">{formatTime(n.created_at)}</div>

                      {isSignupNotification && data && userStatus && userStatus !== "pending" && (
                        <span className={userStatus === "approved" ? "badge success" : "badge danger"}>
                          {userStatus === "approved" ? "Approved" : `Rejected (${daysRemaining} days remaining)`}
                        </span>
                      )}

                      {isFriendRequest && userStatus && userStatus !== "pending" && (
                        <span className={userStatus === "accepted" ? "badge success" : "badge danger"}>
                          {userStatus === "accepted" ? "Accepted" : "Declined"}
                        </span>
                      )}

                      {isFriendRequest && !n.read && userStatus === "pending" && data?.requestId && (
                        <div className="notification-actions">
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => respondToFriendRequest(data.requestId, "decline", n.id)}
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => respondToFriendRequest(data.requestId, "accept", n.id)}
                          >
                            Accept
                          </button>
                        </div>
                      )}

                      {isClubInvite && !n.read && data?.clubId && (
                        <div className="notification-actions">
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => respondToClubInvite(data.clubId, false, n.id)}
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => respondToClubInvite(data.clubId, true, n.id)}
                          >
                            Join
                          </button>
                        </div>
                      )}

                      {isSignupNotification && !n.read && userStatus === "pending" && data && targetUserId && (
                        <div className="notification-actions">
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => rejectUser(targetUserId, n.id)}
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => approveUser(targetUserId, n.id)}
                          >
                            Approve
                          </button>
                        </div>
                      )}
                    </div>
                    {!n.read && userStatus !== "pending" && !(isClubInvite && data?.clubId) && (
                      <button type="button" className="icon-btn" onClick={() => dismiss(n.id)} aria-label="Dismiss">
                        <IconX />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
