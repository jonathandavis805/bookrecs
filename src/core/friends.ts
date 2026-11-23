import { execute, queryAll, queryOne } from "../db";
import { BOOK_COLUMNS } from "./books";
import { listReading, listReads, listWishlist, type MineStatus, type ReadingRow, viewerOwnership } from "./lists";
import { createNotification, markNotificationsRead } from "./notifications";
import { fail, forbidden, notFound, type Result } from "./result";
import { findUser, usernameOf } from "./users";

// Ids of ?1's accepted friends; embed in a query whose first parameter is that user.
export const FRIEND_IDS = `SELECT CASE WHEN f.requester_id = ?1 THEN f.requestee_id ELSE f.requester_id END
  FROM friendships f WHERE (f.requester_id = ?1 OR f.requestee_id = ?1) AND f.status = 'accepted'`;

// Matches a friendship row between ?1 and ?2 in either direction.
const BETWEEN = "((requester_id = ?1 AND requestee_id = ?2) OR (requester_id = ?2 AND requestee_id = ?1))";

export interface FriendRequestRow {
  id: number;
  user_id: number;
  username: string;
}

export async function isFriend(db: D1Database, a: number, b: number): Promise<boolean> {
  return !!(await queryOne(db, `SELECT 1 FROM friendships WHERE status = 'accepted' AND ${BETWEEN}`, a, b));
}

export async function listFriends(db: D1Database, userId: number): Promise<{ user_id: number; username: string }[]> {
  return await queryAll<{ user_id: number; username: string }>(
    db,
    `SELECT id AS user_id, username FROM users WHERE id IN (${FRIEND_IDS}) ORDER BY username COLLATE NOCASE`,
    userId,
  );
}

type FriendReadingRow = Omit<ReadingRow, "category_ids">;

export interface FriendWithReading {
  user_id: number;
  username: string;
  reading: FriendReadingRow[];
}

// Each friend with their two most recent currently-reading books.
export async function listFriendsWithReading(db: D1Database, userId: number): Promise<FriendWithReading[]> {
  const friends = await listFriends(db, userId);
  if (friends.length === 0) return [];
  const rows = await queryAll<FriendReadingRow & { user_id: number }>(
    db,
    `SELECT * FROM (
       SELECT r.user_id, r.book_id, r.listening, r.created_at, ${BOOK_COLUMNS},
              ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.created_at DESC, r.book_id DESC) AS rn
       FROM reading r JOIN books b ON b.id = r.book_id
       WHERE r.user_id IN (${FRIEND_IDS})
     ) WHERE rn <= 2 ORDER BY user_id, rn`,
    userId,
  );
  const byUser = new Map<number, FriendReadingRow[]>();
  for (const { user_id, ...book } of rows) byUser.set(user_id, [...(byUser.get(user_id) ?? []), book]);
  return friends.map((f) => ({ ...f, reading: byUser.get(f.user_id) ?? [] }));
}

export async function listFriendRequests(
  db: D1Database,
  userId: number,
): Promise<{ incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] }> {
  const requests = (other: "requester_id" | "requestee_id", self: "requester_id" | "requestee_id") =>
    queryAll<FriendRequestRow>(
      db,
      `SELECT f.id, u.id AS user_id, u.username
       FROM friendships f JOIN users u ON u.id = f.${other}
       WHERE f.${self} = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      userId,
    );
  return {
    incoming: await requests("requester_id", "requestee_id"),
    outgoing: await requests("requestee_id", "requester_id"),
  };
}

async function notifyAccepted(db: D1Database, requesterId: number, accepterId: number): Promise<void> {
  const name = await usernameOf(db, accepterId);
  await createNotification(db, requesterId, "friend_accepted", `${name} accepted your friend request`, {
    userId: accepterId,
    username: name,
  });
}

export async function sendFriendRequest(
  db: D1Database,
  requesterId: number,
  identifier: unknown,
): Promise<Result<{ username: string; autoAccepted?: boolean }>> {
  const target = await findUser(db, String(identifier ?? ""));
  if (!target) return notFound("User not found");
  if (target.id === requesterId) return fail("You can't add yourself");

  const existing = await queryOne<{ id: number; requester_id: number; status: string }>(
    db,
    `SELECT id, requester_id, status FROM friendships WHERE ${BETWEEN}`,
    requesterId,
    target.id,
  );
  if (existing?.status === "accepted") return fail("You are already friends");
  if (existing?.requester_id === requesterId) return fail("Friend request already sent");
  if (existing) {
    // They already asked us: accept their request instead of sending one back.
    await acceptRequest(db, existing.id, target.id, requesterId);
    return { ok: true, autoAccepted: true, username: target.username };
  }

  const friendship = await queryOne<{ id: number }>(
    db,
    "INSERT INTO friendships (requester_id, requestee_id, status) VALUES (?, ?, 'pending') RETURNING id",
    requesterId,
    target.id,
  );
  const name = await usernameOf(db, requesterId);
  await createNotification(db, target.id, "friend_request", `${name} sent you a friend request`, {
    requestId: friendship?.id,
    userId: requesterId,
    username: name,
  });
  return { ok: true, username: target.username };
}

async function acceptRequest(db: D1Database, requestId: number, requesterId: number, accepterId: number) {
  await execute(db, "UPDATE friendships SET status = 'accepted' WHERE id = ?", requestId);
  await markNotificationsRead(db, "friend_request", "requestId", requestId, accepterId);
  await notifyAccepted(db, requesterId, accepterId);
}

export async function acceptFriendRequest(db: D1Database, userId: number, requestId: number): Promise<Result> {
  const f = await queryOne<{ requester_id: number }>(
    db,
    "SELECT requester_id FROM friendships WHERE id = ? AND requestee_id = ? AND status = 'pending'",
    requestId,
    userId,
  );
  if (!f) return notFound("Request not found");
  await acceptRequest(db, requestId, f.requester_id, userId);
  return { ok: true };
}

export async function declineFriendRequest(db: D1Database, userId: number, requestId: number): Promise<Result> {
  await execute(
    db,
    "DELETE FROM friendships WHERE id = ? AND requestee_id = ? AND status = 'pending'",
    requestId,
    userId,
  );
  await markNotificationsRead(db, "friend_request", "requestId", requestId, userId);
  return { ok: true };
}

export async function removeFriend(db: D1Database, userId: number, friendId: number): Promise<void> {
  await execute(db, `DELETE FROM friendships WHERE status = 'accepted' AND ${BETWEEN}`, userId, friendId);
}

export type FriendList = "books" | "wishlist" | "reading";

// A friend's public reads or wishlist, or their currently-reading list, each
// book marked with whether the viewer already has it.
export async function getFriendList(
  db: D1Database,
  viewerId: number,
  friendUsername: string,
  list: FriendList,
): Promise<Result<{ user: { id: number; username: string }; books: { mine: MineStatus }[] }>> {
  const friend = await findUser(db, friendUsername);
  if (!friend) return notFound("User not found");
  if (friend.id === viewerId) return fail("That's you — use your own list");
  if (!(await isFriend(db, viewerId, friend.id))) return forbidden("You are not friends with this user");

  const rows =
    list === "books"
      ? await listReads(db, friend.id, true)
      : list === "wishlist"
        ? await listWishlist(db, friend.id, true)
        : await listReading(db, friend.id);
  const mine = await viewerOwnership(db, viewerId);
  return {
    ok: true,
    user: { id: friend.id, username: friend.username },
    books: rows.map((b) => ({ ...b, mine: mine(b.book_id) })),
  };
}
