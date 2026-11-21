// Turns raw notification rows into what the panel shows: items that need a
// response stay individual; informational ones collapse into one entry per
// club and topic (or per topic for friend activity).

export interface NotificationRow {
  id: number;
  type: string;
  message: string;
  data: string | null;
  read: number;
  created_at: number;
}

export interface NotificationItem {
  key: string;
  ids: number[];
  type: string;
  actionable: boolean;
  message: string;
  // Individual messages, newest first, when several rows were grouped.
  details: string[];
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: number;
}

const GROUPS: Record<string, string> = {
  club_nomination: "club_nominations",
  club_nomination_removed: "club_nominations",
  club_nominations_open: "club_nominations",
  club_voting_open: "club_voting",
  club_veto: "club_voting",
  club_runoff: "club_voting",
  club_nominations_reset: "club_voting",
  club_pick: "club_voting",
  club_joined: "club_members",
  club_owner: "club_members",
  friend_accepted: "friends",
};

const SUMMARIES: Record<string, (count: number, club: string) => string> = {
  club_nominations: (n, club) => `${n} nomination updates in "${club}"`,
  club_voting: (n, club) => `${n} voting updates in "${club}"`,
  club_members: (n, club) => `${n} member updates in "${club}"`,
  friends: (n) => `${n} people accepted your friend request`,
};

// Older rows were written as "@name did X"; usernames now display without the @.
// Only a leading-word @ is removed, so email addresses survive.
function displayMessage(message: string): string {
  return message.replace(/(^|\s)@(?=\w)/g, "$1");
}

function parse(data: string | null): Record<string, unknown> | null {
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Status fields are filled in by getNotifications from the live friendship,
// membership and user rows, so a request handled elsewhere stops being actionable.
export function isActionable(row: NotificationRow): boolean {
  const data = parse(row.data);
  if (row.read || !data) return false;
  if (row.type === "friend_request" || row.type === "club_invite" || row.type === "new_user_signup") {
    return data.status === "pending";
  }
  return false;
}

export function groupNotifications(rows: NotificationRow[]): NotificationItem[] {
  const sorted = [...rows].sort((a, b) => b.created_at - a.created_at || b.id - a.id);
  const items: NotificationItem[] = [];
  const groups = new Map<string, NotificationItem>();

  for (const row of sorted) {
    const data = parse(row.data);
    const message = displayMessage(row.message);
    const actionable = isActionable(row);
    const group = GROUPS[row.type];
    if (actionable || !group) {
      items.push({
        key: `${row.type}:${row.id}`,
        ids: [row.id],
        type: row.type,
        actionable,
        message,
        details: [],
        data,
        read: !!row.read,
        created_at: row.created_at,
      });
      continue;
    }

    // Unread and already-read rows never merge, so new activity isn't hidden in an old group.
    const key = `${group}:${data?.clubId ?? ""}:${row.read ? "read" : "unread"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(row.id);
      existing.details.push(message);
      continue;
    }
    const item: NotificationItem = {
      key,
      ids: [row.id],
      type: group,
      actionable: false,
      message,
      details: [message],
      data,
      read: !!row.read,
      created_at: row.created_at,
    };
    groups.set(key, item);
    items.push(item);
  }

  for (const item of groups.values()) {
    if (item.ids.length === 1) {
      item.details = [];
      continue;
    }
    const club = String(item.data?.name ?? "your club");
    item.message = SUMMARIES[item.type](item.ids.length, club);
    // The summary already names the club, so drop it from each line.
    item.details = item.details.map((d) => d.replaceAll(` in "${club}"`, "").replaceAll(` the club "${club}"`, ""));
  }

  // Anything needing a response comes first; otherwise newest first.
  return items.sort((a, b) => Number(b.actionable) - Number(a.actionable) || b.created_at - a.created_at);
}
