import { execute, now, queryAll, queryOne } from "../db";
import { getClubMembership } from "./clubs";
import { groupNotifications, isActionable, type NotificationItem, type NotificationRow } from "./notification-groups";
import { getAdminUsers, getUserById } from "./users";

// How long dismissed notifications stay visible under "Earlier" in the panel.
const READ_NOTIFICATION_DAYS = 7;

export async function createNotification(
  db: D1Database,
  userId: number,
  type: string,
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await execute(
    db,
    "INSERT INTO notifications (user_id, type, message, data) VALUES (?, ?, ?, ?)",
    userId,
    type,
    message,
    data ? JSON.stringify(data) : null,
  );
}

// Marks notifications of a type whose data[key] matches as handled, for one
// user or (for admin alerts) everyone who got one.
export async function markNotificationsRead(
  db: D1Database,
  type: string,
  key: string,
  value: number,
  userId?: number,
): Promise<void> {
  await execute(
    db,
    `UPDATE notifications SET read = 1
     WHERE type = ?1 AND json_extract(data, '$.' || ?2) = ?3 AND (?4 IS NULL OR user_id = ?4)`,
    type,
    key,
    value,
    userId ?? null,
  );
}

export async function notifyAdminsOfSignup(
  db: D1Database,
  user: { id: number; username: string; email: string },
): Promise<void> {
  for (const admin of await getAdminUsers(db)) {
    await createNotification(db, admin.id, "new_user_signup", `New user signed up: ${user.username} (${user.email})`, {
      id: user.id,
      username: user.username,
      email: user.email,
    });
  }
}

// The live status of whatever an actionable notification refers to, so one
// handled elsewhere (or withdrawn) stops offering its buttons.
async function liveStatus(db: D1Database, userId: number, type: string, data: Record<string, unknown>) {
  if (type === "new_user_signup") {
    // Older rows used userId instead of id.
    const user = await getUserById(db, Number(data.userId ?? data.id));
    return user && { status: user.status, rejected_at: user.rejected_at };
  }
  if (type === "friend_request" && data.requestId) {
    const f = await queryOne<{ status: string }>(db, "SELECT status FROM friendships WHERE id = ?", data.requestId);
    return { status: f?.status ?? "declined" };
  }
  if (type === "club_invite" && data.clubId) {
    const membership = await getClubMembership(db, Number(data.clubId), userId);
    return { status: membership?.status ?? "cancelled" };
  }
  return null;
}

// Unread rows plus recently read ones, with live status merged into data.
async function getNotificationRows(db: D1Database, userId: number): Promise<NotificationRow[]> {
  const rows = await queryAll<NotificationRow>(
    db,
    "SELECT * FROM notifications WHERE user_id = ? AND (read = 0 OR created_at > ?) ORDER BY created_at DESC",
    userId,
    now() - READ_NOTIFICATION_DAYS * 86400,
  );
  for (const row of rows) {
    if (row.read || !row.data) continue;
    try {
      const data = JSON.parse(row.data);
      const status = await liveStatus(db, userId, row.type, data);
      if (status) row.data = JSON.stringify({ ...data, ...status });
    } catch {
      // Malformed data: leave the row as is.
    }
  }
  return rows;
}

export async function getNotifications(
  db: D1Database,
  userId: number,
): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const notifications = groupNotifications(await getNotificationRows(db, userId));
  return { notifications, unreadCount: notifications.filter((n) => !n.read).length };
}

// Opening the panel counts as reading everything that doesn't need a response.
export async function markInformationalNotificationsRead(db: D1Database, userId: number): Promise<void> {
  const ids = (await getNotificationRows(db, userId)).filter((n) => !n.read && !isActionable(n)).map((n) => n.id);
  if (ids.length === 0) return;
  await execute(
    db,
    `UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    userId,
    ...ids,
  );
}
