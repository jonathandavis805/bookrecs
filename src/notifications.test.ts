import { describe, expect, test } from "bun:test";
import { groupNotifications, type NotificationRow } from "./notifications";

let nextId = 1;
function row(
  type: string,
  data: Record<string, unknown>,
  opts: { read?: boolean; at?: number; message?: string } = {},
) {
  const id = nextId++;
  return {
    id,
    type,
    message: opts.message ?? `${type} ${id}`,
    data: JSON.stringify(data),
    read: opts.read ? 1 : 0,
    created_at: opts.at ?? id,
  } satisfies NotificationRow;
}

const club = (clubId: number) => ({ clubId, name: `Club ${clubId}` });

describe("groupNotifications", () => {
  test("collapses nomination and voting activity per club", () => {
    const items = groupNotifications([
      row("club_nomination", club(1)),
      row("club_nomination", club(1)),
      row("club_nominations_open", club(1)),
      row("club_veto", club(1)),
      row("club_pick", club(1)),
      row("club_nomination", club(2)),
    ]);

    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey["club_nominations:1:unread"].ids).toHaveLength(3);
    expect(byKey["club_nominations:1:unread"].message).toBe('3 nomination updates in "Club 1"');
    expect(byKey["club_voting:1:unread"].ids).toHaveLength(2);
    expect(byKey["club_nominations:2:unread"].ids).toHaveLength(1);
    expect(items).toHaveLength(3);
  });

  test("drops the repeated club name from grouped lines", () => {
    const [item] = groupNotifications([
      row("club_nomination", club(1), { at: 2, message: 'carol nominated "Dune" in "Club 1"' }),
      row("club_nominations_open", club(1), { at: 1, message: 'Nominations are open for the next book in "Club 1"' }),
    ]);
    expect(item.details).toEqual(['carol nominated "Dune"', "Nominations are open for the next book"]);
  });

  test("a group of one keeps its original message and no details", () => {
    const [item] = groupNotifications([row("club_joined", club(1), { message: "bob joined" })]);
    expect(item.message).toBe("bob joined");
    expect(item.details).toEqual([]);
  });

  test("strips the legacy @ from usernames but not from emails", () => {
    const [a, b] = groupNotifications([
      row("club_owner", club(1), { at: 2, message: "@bob transferred ownership" }),
      row("new_user_signup", { id: 9, status: "approved" }, { at: 1, message: "New user signed up: bob (bob@x.test)" }),
    ]);
    expect(a.message).toBe("bob transferred ownership");
    expect(b.message).toBe("New user signed up: bob (bob@x.test)");
  });

  test("groups list details newest first", () => {
    const [item] = groupNotifications([
      row("friend_accepted", {}, { at: 10, message: "older" }),
      row("friend_accepted", {}, { at: 20, message: "newer" }),
    ]);
    expect(item.details).toEqual(["newer", "older"]);
    expect(item.message).toBe("2 people accepted your friend request");
  });

  test("never merges unread activity into an already-read group", () => {
    const items = groupNotifications([
      row("club_nomination", club(1), { read: true }),
      row("club_nomination", club(1)),
    ]);
    expect(items.map((i) => i.read).sort()).toEqual([false, true]);
  });

  test("pending requests stay individual, actionable and first", () => {
    const items = groupNotifications([
      row("club_nomination", club(1), { at: 100 }),
      row("friend_request", { requestId: 1, status: "pending" }, { at: 1 }),
      row("friend_request", { requestId: 2, status: "pending" }, { at: 2 }),
      row("club_invite", { ...club(3), status: "pending" }, { at: 3 }),
    ]);
    expect(items.slice(0, 3).every((i) => i.actionable)).toBe(true);
    expect(items[3].type).toBe("club_nominations");
  });

  test("handled or cancelled requests are informational", () => {
    const items = groupNotifications([
      row("friend_request", { requestId: 1, status: "accepted" }),
      row("club_invite", { ...club(3), status: "cancelled" }),
      row("new_user_signup", { id: 9, status: "approved" }),
    ]);
    expect(items.some((i) => i.actionable)).toBe(false);
  });
});
