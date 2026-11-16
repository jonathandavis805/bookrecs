import { useEffect, useState } from "react";
import { api } from "../api";

interface Notification {
  id: number;
  type: string;
  message: string;
  data: string | null;
  read: number;
  created_at: number;
}

interface NotificationsProps {
  onClose: () => void;
  onCountChange: (count: number) => void;
}

export default function Notifications({ onClose, onCountChange }: NotificationsProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const data = await api<{ notifications: Notification[]; unreadCount: number }>("/api/notifications");
      setNotifications(data.notifications);
      onCountChange(data.unreadCount);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  }

  async function dismiss(id: number) {
    try {
      await api(`/api/notifications/${id}/dismiss`, { method: "POST" });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
      onCountChange(notifications.filter((n) => !n.read && n.id !== id).length);
    } catch (err) {
      console.error("Failed to dismiss notification:", err);
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

  async function approveUser(userId: number, notificationId: number) {
    try {
      await api(`/api/users/${userId}/approve`, { method: "POST" });
      setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: 1 } : n)));
      onCountChange(notifications.filter((n) => !n.read && n.id !== notificationId).length);
    } catch (err) {
      console.error("Failed to approve user:", err);
    }
  }

  async function rejectUser(userId: number, notificationId: number) {
    try {
      await api(`/api/users/${userId}/reject`, { method: "POST" });
      setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: 1 } : n)));
      onCountChange(notifications.filter((n) => !n.read && n.id !== notificationId).length);
    } catch (err) {
      console.error("Failed to reject user:", err);
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal notifications-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Notifications</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="notifications-content">
          {loading ? (
            <div className="loading">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="empty">No notifications yet.</div>
          ) : (
            <>
              {notifications.some((n) => !n.read) && (
                <div className="notifications-actions">
                  <button className="link" onClick={dismissAll}>
                    Dismiss all
                  </button>
                </div>
              )}
              <ul className="notifications-list">
                {notifications.map((n) => {
                  const data = n.data ? JSON.parse(n.data) : null;
                  const isSignupNotification = n.type === "new_user_signup";
                  const userStatus = data?.status;
                  const rejectedAt = data?.rejected_at;
                  
                  // Calculate days remaining for rejected users
                  let daysRemaining = 0;
                  if (userStatus === "rejected" && rejectedAt) {
                    const gracePeriodDays = 7;
                    const rejectedDate = new Date(rejectedAt * 1000);
                    const now = new Date();
                    const daysSinceRejection = Math.floor((now.getTime() - rejectedDate.getTime()) / 86400000);
                    daysRemaining = Math.max(0, gracePeriodDays - daysSinceRejection);
                  }

                  return (
                    <li key={n.id} className={`notification-item ${!n.read ? "unread" : ""}`}>
                      <div className="notification-content">
                        <div className="notification-message">{n.message}</div>
                        <div className="notification-time">{formatTime(n.created_at)}</div>
                        
                        {/* Show status for processed signup notifications */}
                        {isSignupNotification && data && userStatus && userStatus !== "pending" && (
                          <div className={`notification-status status-${userStatus}`}>
                            {userStatus === "approved" && "✓ Approved"}
                            {userStatus === "rejected" && `✗ Rejected (${daysRemaining} days remaining)`}
                          </div>
                        )}
                        
                        {/* Show approve/reject buttons only for pending users */}
                        {isSignupNotification && !n.read && userStatus === "pending" && data && (
                          <div className="notification-actions">
                            <button
                              className="btn-small btn-success"
                              onClick={() => approveUser(data.id, n.id)}
                            >
                              Approve
                            </button>
                            <button
                              className="btn-small btn-danger"
                              onClick={() => rejectUser(data.id, n.id)}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                      {!n.read && userStatus !== "pending" && (
                        <button className="notification-dismiss" onClick={() => dismiss(n.id)}>
                          ×
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
