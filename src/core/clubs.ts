import { execute, queryAll, queryOne } from "../db";
import { type BookRef, resolveBook } from "./books";
import { isFriend } from "./friends";
import { createNotification, markNotificationsRead } from "./notifications";
import { type Failure, fail, forbidden, notFound, type Result } from "./result";
import { findUser, type User, usernameOf } from "./users";

export interface ClubRow {
  id: number;
  name: string;
  description: string | null;
  creator_id: number;
  voting_open: number;
  nominations_open: number;
  runoff: number;
  created_at: number;
}

interface Membership {
  role: "owner" | "member";
  status: "pending" | "accepted";
  invited_by: number | null;
}

interface ClubMemberRow {
  user_id: number;
  username: string;
  role: "owner" | "member";
  status: "pending" | "accepted";
  joined_at: number;
}

interface ClubNominationRow {
  id: number;
  book_id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  user_id: number;
  nominatedBy: string;
  votes: number;
  vetoed_by: number | null;
  vetoedBy: string | null;
  created_at: number;
}

interface ClubPickRow {
  id: number;
  book_id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  picked_at: number;
}

export interface ClubSummary {
  id: number;
  name: string;
  description: string | null;
  role: "owner" | "member";
  memberCount: number;
  invitedCount: number;
  voting_open: number;
  nominations_open: number;
  nominationCount: number;
  currentPick: ClubPickRow | null;
  created_at: number;
}

export interface ClubInviteSummary {
  clubId: number;
  name: string;
  description: string | null;
  inviter: string | null;
  invited_at: number;
}

export interface ClubDetail {
  club: ClubRow;
  myRole: "owner" | "member";
  votingOpen: boolean;
  nominationsOpen: boolean;
  runoff: boolean;
  members: ClubMemberRow[];
  nominations: ClubNominationRow[];
  myVote: number | null;
  myVetoUsed: boolean;
  currentPick: ClubPickRow | null;
  pastPicks: ClubPickRow[];
}

const PICK_COLUMNS =
  "p.id, p.club_id, p.book_id, p.picked_at, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual";

// Nominations with their live vote counts.
const NOMINATIONS = `SELECT n.id, n.book_id, n.user_id, n.created_at, n.vetoed_by,
    u.username AS nominatedBy,
    (SELECT username FROM users WHERE id = n.vetoed_by) AS vetoedBy,
    b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual,
    (SELECT COUNT(*) FROM club_votes v WHERE v.nomination_id = n.id) AS votes
  FROM club_nominations n JOIN books b ON b.id = n.book_id JOIN users u ON u.id = n.user_id
  WHERE n.club_id = ?`;

export async function getClubMembership(db: D1Database, clubId: number, userId: number): Promise<Membership | null> {
  return await queryOne<Membership>(
    db,
    "SELECT role, status, invited_by FROM club_members WHERE club_id = ? AND user_id = ?",
    clubId,
    userId,
  );
}

// Loads a club and checks the caller's standing: "any" includes pending
// invitees, "member" means joined, "owner" also names what is being refused.
async function loadClub(
  db: D1Database,
  userId: number,
  clubId: number,
  role: "any" | "member" | "owner",
  ownerAction = "",
): Promise<Result<{ club: ClubRow; membership: Membership }>> {
  const club = await queryOne<ClubRow>(db, "SELECT * FROM clubs WHERE id = ?", clubId);
  if (!club) return notFound("Club not found");
  const membership = await getClubMembership(db, clubId, userId);
  if (!membership) return forbidden("You are not a member of this club");
  if (role !== "any" && membership.status !== "accepted") return forbidden("You haven't joined this club yet");
  if (role === "owner" && membership.role !== "owner") return forbidden(`Only the club owner can ${ownerAction}`);
  return { ok: true, club, membership };
}

function votingClosed(club: ClubRow, closed = "Voting is closed for the current pick"): Failure | null {
  if (club.voting_open === 1) return null;
  return fail(club.nominations_open === 1 ? "Voting hasn't opened yet — the club is still nominating" : closed);
}

async function clearVote(db: D1Database, clubId: number, userId: number): Promise<void> {
  await execute(
    db,
    "DELETE FROM club_votes WHERE user_id = ? AND nomination_id IN (SELECT id FROM club_nominations WHERE club_id = ?)",
    userId,
    clubId,
  );
}

async function clearAllVotes(db: D1Database, clubId: number): Promise<void> {
  await execute(
    db,
    "DELETE FROM club_votes WHERE nomination_id IN (SELECT id FROM club_nominations WHERE club_id = ?)",
    clubId,
  );
}

async function notifyMembers(
  db: D1Database,
  club: ClubRow,
  actorId: number,
  type: string,
  message: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const members = await queryAll<{ user_id: number }>(
    db,
    "SELECT user_id FROM club_members WHERE club_id = ? AND status = 'accepted' AND user_id != ?",
    club.id,
    actorId,
  );
  for (const m of members) {
    await createNotification(db, m.user_id, type, message, { clubId: club.id, name: club.name, ...data });
  }
}

// ---------- Vote counting ----------

interface Tallied {
  votes: number;
}

// A pick needs a simple majority: more than half the votes cast.
function tally<T extends Tallied>(nominations: T[]) {
  const totalVotes = nominations.reduce((sum, n) => sum + n.votes, 0);
  const topVotes = Math.max(0, ...nominations.map((n) => n.votes));
  const leaders = nominations.filter((n) => n.votes === topVotes);
  return { totalVotes, leaders, hasMajority: leaders.length === 1 && topVotes * 2 > totalVotes };
}

// The runoff field: the top two vote-getters. A tie at the top keeps all
// tied leaders; a single leader is joined by whoever ties for second.
// Mirrors runoffField in web/src/components/ClubDetail.tsx.
function runoffField<T extends Tallied>(nominations: T[]): T[] {
  const { leaders } = tally(nominations);
  if (leaders.length > 1) return leaders;
  const rest = nominations.filter((n) => n.votes < leaders[0].votes);
  if (rest.length === 0) return leaders;
  return [...leaders, ...tally(rest).leaders];
}

async function activeNominations(db: D1Database, clubId: number) {
  return await queryAll<{ id: number; book_id: number; title: string; votes: number }>(
    db,
    `SELECT n.id, n.book_id, b.title, (SELECT COUNT(*) FROM club_votes v WHERE v.nomination_id = n.id) AS votes
     FROM club_nominations n JOIN books b ON b.id = n.book_id
     WHERE n.club_id = ? AND n.vetoed_by IS NULL
     ORDER BY n.created_at ASC`,
    clubId,
  );
}

const quoted = (titles: string[], joiner: string) => titles.map((t) => `"${t}"`).join(joiner);

// ---------- Creating, listing and viewing ----------

async function checkInvitable(
  db: D1Database,
  clubId: number,
  inviterId: number,
  username: string,
): Promise<Result<{ target: User }>> {
  const target = await findUser(db, username);
  if (!target) return notFound("User not found");
  if (target.id === inviterId) return fail("You are already in this club");
  if (!(await isFriend(db, inviterId, target.id))) return forbidden("You can only invite friends");
  const existing = await getClubMembership(db, clubId, target.id);
  if (existing) {
    return fail(`${target.username} is already ${existing.status === "accepted" ? "a member" : "invited"}`);
  }
  return { ok: true, target };
}

async function addInvite(db: D1Database, club: ClubRow, inviterId: number, target: User): Promise<void> {
  await execute(
    db,
    "INSERT INTO club_members (club_id, user_id, role, status, invited_by) VALUES (?, ?, 'member', 'pending', ?)",
    club.id,
    target.id,
    inviterId,
  );
  const inviter = await usernameOf(db, inviterId);
  await createNotification(db, target.id, "club_invite", `${inviter} invited you to the club "${club.name}"`, {
    clubId: club.id,
    name: club.name,
    userId: inviterId,
    username: inviter,
  });
}

export async function createClub(
  db: D1Database,
  creatorId: number,
  name: unknown,
  description: unknown,
  usernames: string[] = [],
): Promise<Result<{ club: ClubRow; invited: string[]; skipped: string[] }>> {
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName) return fail("Club name is required");
  if (cleanName.length > 80) return fail("Club name must be 80 characters or fewer");
  const cleanDesc = typeof description === "string" && description.trim() ? description.trim().slice(0, 500) : null;

  const club = await queryOne<ClubRow>(
    db,
    "INSERT INTO clubs (name, description, creator_id, voting_open, nominations_open) VALUES (?, ?, ?, 0, 1) RETURNING *",
    cleanName,
    cleanDesc,
    creatorId,
  );
  if (!club) return fail("Could not create club");
  await execute(
    db,
    "INSERT INTO club_members (club_id, user_id, role, status, invited_by) VALUES (?1, ?2, 'owner', 'accepted', ?2)",
    club.id,
    creatorId,
  );

  const invited: string[] = [];
  const skipped: string[] = [];
  for (const raw of usernames.slice(0, 50)) {
    const r = await checkInvitable(db, club.id, creatorId, String(raw));
    if (!r.ok) {
      skipped.push(String(raw).trim());
      continue;
    }
    await addInvite(db, club, creatorId, r.target);
    invited.push(r.target.username);
  }
  return { ok: true, club, invited, skipped };
}

export async function listClubsForUser(
  db: D1Database,
  userId: number,
): Promise<{ clubs: ClubSummary[]; invites: ClubInviteSummary[] }> {
  const clubs = await queryAll<Omit<ClubSummary, "currentPick">>(
    db,
    `SELECT c.id, c.name, c.description, c.voting_open, c.nominations_open, c.created_at, m.role,
       (SELECT COUNT(*) FROM club_members cm WHERE cm.club_id = c.id AND cm.status = 'accepted') AS memberCount,
       (SELECT COUNT(*) FROM club_members cm WHERE cm.club_id = c.id AND cm.status = 'pending') AS invitedCount,
       (SELECT COUNT(*) FROM club_nominations n WHERE n.club_id = c.id) AS nominationCount
     FROM clubs c JOIN club_members m ON m.club_id = c.id
     WHERE m.user_id = ? AND m.status = 'accepted'
     ORDER BY c.created_at DESC`,
    userId,
  );
  const picks = await queryAll<ClubPickRow & { club_id: number }>(
    db,
    `SELECT * FROM (
       SELECT ${PICK_COLUMNS}, ROW_NUMBER() OVER (PARTITION BY p.club_id ORDER BY p.picked_at DESC, p.id DESC) AS rn
       FROM club_picks p JOIN books b ON b.id = p.book_id
       WHERE p.club_id IN (SELECT club_id FROM club_members WHERE user_id = ? AND status = 'accepted')
     ) WHERE rn = 1`,
    userId,
  );
  const pickByClub = new Map(picks.map(({ club_id, ...pick }) => [club_id, pick]));

  const invites = await queryAll<ClubInviteSummary>(
    db,
    `SELECT m.club_id AS clubId, c.name, c.description, m.joined_at AS invited_at,
       (SELECT username FROM users WHERE id = m.invited_by) AS inviter
     FROM club_members m JOIN clubs c ON c.id = m.club_id
     WHERE m.user_id = ? AND m.status = 'pending'
     ORDER BY m.joined_at DESC`,
    userId,
  );
  return { clubs: clubs.map((c) => ({ ...c, currentPick: pickByClub.get(c.id) ?? null })), invites };
}

export async function getClub(db: D1Database, userId: number, clubId: number): Promise<Result<{ club: ClubDetail }>> {
  const r = await loadClub(db, userId, clubId, "member");
  if (!r.ok) return r;
  const { club, membership } = r;

  const members = await queryAll<ClubMemberRow>(
    db,
    `SELECT m.user_id, u.username, m.role, m.status, m.joined_at
     FROM club_members m JOIN users u ON u.id = m.user_id
     WHERE m.club_id = ?
     ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, CASE m.status WHEN 'accepted' THEN 0 ELSE 1 END,
       u.username COLLATE NOCASE`,
    clubId,
  );
  const nominations = await queryAll<ClubNominationRow>(db, `${NOMINATIONS} ORDER BY n.created_at ASC`, clubId);
  const myVote = await queryOne<{ nomination_id: number }>(
    db,
    `SELECT v.nomination_id FROM club_votes v JOIN club_nominations n ON n.id = v.nomination_id
     WHERE v.user_id = ? AND n.club_id = ?`,
    userId,
    clubId,
  );
  const picks = await queryAll<ClubPickRow>(
    db,
    `SELECT ${PICK_COLUMNS} FROM club_picks p JOIN books b ON b.id = p.book_id
     WHERE p.club_id = ? ORDER BY p.picked_at DESC, p.id DESC`,
    clubId,
  );

  return {
    ok: true,
    club: {
      club,
      myRole: membership.role,
      votingOpen: club.voting_open === 1,
      nominationsOpen: club.nominations_open === 1,
      runoff: club.runoff === 1,
      members,
      nominations,
      myVote: myVote?.nomination_id ?? null,
      myVetoUsed: nominations.some((n) => n.vetoed_by === userId),
      currentPick: picks[0] ?? null,
      pastPicks: picks.slice(1),
    },
  };
}

// ---------- Membership ----------

export async function inviteToClub(
  db: D1Database,
  inviterId: number,
  clubId: number,
  username: unknown,
): Promise<Result<{ username: string }>> {
  const r = await loadClub(db, inviterId, clubId, "member");
  if (!r.ok) return r;
  const check = await checkInvitable(db, clubId, inviterId, String(username ?? ""));
  if (!check.ok) return check;
  await addInvite(db, r.club, inviterId, check.target);
  return { ok: true, username: check.target.username };
}

export async function respondToClubInvite(
  db: D1Database,
  userId: number,
  clubId: number,
  accept: boolean,
): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "any");
  if (!r.ok) return r;
  if (r.membership.status !== "pending") return fail("No pending invite for this club");

  if (accept) {
    await execute(db, "UPDATE club_members SET status = 'accepted' WHERE club_id = ? AND user_id = ?", clubId, userId);
    if (r.membership.invited_by) {
      const joiner = await usernameOf(db, userId);
      await createNotification(
        db,
        r.membership.invited_by,
        "club_joined",
        `${joiner} joined the club "${r.club.name}"`,
        {
          clubId,
          name: r.club.name,
          userId,
          username: joiner,
        },
      );
    }
  } else {
    await execute(db, "DELETE FROM club_members WHERE club_id = ? AND user_id = ?", clubId, userId);
  }
  // Handled here or in the notifications panel, the invite is dealt with either way.
  await markNotificationsRead(db, "club_invite", "clubId", clubId, userId);
  return { ok: true };
}

export async function removeClubMember(
  db: D1Database,
  userId: number,
  clubId: number,
  targetUserId: number,
): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "owner", "remove members");
  if (!r.ok) return r;
  if (targetUserId === userId) return fail("You can't remove yourself");
  const target = await getClubMembership(db, clubId, targetUserId);
  if (!target) return notFound("Member not found");
  if (target.role === "owner") return fail("You can't remove the club owner");
  await execute(db, "DELETE FROM club_members WHERE club_id = ? AND user_id = ?", clubId, targetUserId);
  await clearVote(db, clubId, targetUserId);
  return { ok: true };
}

export async function leaveClub(db: D1Database, userId: number, clubId: number): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "any");
  if (!r.ok) return r;
  if (r.membership.role === "owner") {
    return fail("Owners can't leave directly — transfer ownership or delete the club");
  }
  await execute(db, "DELETE FROM club_members WHERE club_id = ? AND user_id = ?", clubId, userId);
  await clearVote(db, clubId, userId);
  return { ok: true };
}

export async function deleteClub(db: D1Database, userId: number, clubId: number): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "owner", "delete the club");
  if (!r.ok) return r;
  await execute(db, "DELETE FROM clubs WHERE id = ?", clubId);
  return { ok: true };
}

export async function transferClubOwnership(
  db: D1Database,
  userId: number,
  clubId: number,
  targetUserId: number,
): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "owner", "transfer ownership");
  if (!r.ok) return r;
  if (targetUserId === userId) return fail("You already own this club");
  const target = await getClubMembership(db, clubId, targetUserId);
  if (target?.status !== "accepted") return fail("Pick an accepted member of this club");

  // The successor takes over; the former owner leaves (their vote goes with them).
  await execute(db, "UPDATE club_members SET role = 'owner' WHERE club_id = ? AND user_id = ?", clubId, targetUserId);
  await execute(db, "DELETE FROM club_members WHERE club_id = ? AND user_id = ?", clubId, userId);
  await clearVote(db, clubId, userId);

  const oldOwner = await usernameOf(db, userId);
  await createNotification(
    db,
    targetUserId,
    "club_owner",
    `${oldOwner} transferred ownership of "${r.club.name}" to you`,
    { clubId, name: r.club.name, userId, username: oldOwner },
  );
  return { ok: true };
}

// ---------- Nominating and voting ----------

export async function nominateBook(db: D1Database, userId: number, clubId: number, ref: BookRef): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "member");
  if (!r.ok) return r;
  if (r.club.nominations_open !== 1) {
    return fail(
      r.club.voting_open === 1
        ? "Nominations are closed while voting is open"
        : "Nominations are closed for the current pick",
    );
  }
  const b = await resolveBook(db, ref);
  if (!b.ok) return b;
  const dup = await queryOne(db, "SELECT 1 FROM club_nominations WHERE club_id = ? AND book_id = ?", clubId, b.book.id);
  if (dup) return fail("That book is already nominated");

  await execute(
    db,
    "INSERT INTO club_nominations (club_id, user_id, book_id) VALUES (?, ?, ?)",
    clubId,
    userId,
    b.book.id,
  );
  const nominator = await usernameOf(db, userId);
  await notifyMembers(
    db,
    r.club,
    userId,
    "club_nomination",
    `${nominator} nominated "${b.book.title}" in "${r.club.name}"`,
    {
      nominationBook: b.book.title,
    },
  );
  return { ok: true };
}

export async function voteForNomination(
  db: D1Database,
  userId: number,
  clubId: number,
  nominationId: number,
): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "member");
  if (!r.ok) return r;
  const closed = votingClosed(r.club);
  if (closed) return closed;
  const nomination = await queryOne<{ vetoed_by: number | null }>(
    db,
    "SELECT vetoed_by FROM club_nominations WHERE id = ? AND club_id = ?",
    nominationId,
    clubId,
  );
  if (!nomination) return notFound("Nomination not found");
  if (nomination.vetoed_by != null) return fail("That nomination was vetoed");

  // One vote per member per club: replace any previous vote.
  await clearVote(db, clubId, userId);
  await execute(db, "INSERT INTO club_votes (nomination_id, user_id) VALUES (?, ?)", nominationId, userId);
  return { ok: true };
}

export async function removeVote(db: D1Database, userId: number, clubId: number): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "member");
  if (!r.ok) return r;
  await clearVote(db, clubId, userId);
  return { ok: true };
}

async function nominationTitle(db: D1Database, clubId: number, nominationId: number) {
  return await queryOne<{ title: string; vetoed_by: number | null }>(
    db,
    `SELECT b.title, n.vetoed_by FROM club_nominations n JOIN books b ON b.id = n.book_id
     WHERE n.id = ? AND n.club_id = ?`,
    nominationId,
    clubId,
  );
}

export async function vetoNomination(
  db: D1Database,
  userId: number,
  clubId: number,
  nominationId: number,
): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "member");
  if (!r.ok) return r;
  const closed = votingClosed(r.club);
  if (closed) return closed;
  const nomination = await nominationTitle(db, clubId, nominationId);
  if (!nomination) return notFound("Nomination not found");
  if (nomination.vetoed_by != null) return fail("That nomination was already vetoed");

  // One veto per member per vote cycle (a cycle's vetoes die with its
  // nominations when the vote closes).
  const used = await queryOne(db, "SELECT 1 FROM club_nominations WHERE club_id = ? AND vetoed_by = ?", clubId, userId);
  if (used) return fail("You've already used your veto for this vote");

  await execute(db, "UPDATE club_nominations SET vetoed_by = ? WHERE id = ?", userId, nominationId);
  // Anyone voting for it gets their vote back.
  await execute(db, "DELETE FROM club_votes WHERE nomination_id = ?", nominationId);
  const vetoer = await usernameOf(db, userId);
  await notifyMembers(db, r.club, userId, "club_veto", `${vetoer} vetoed "${nomination.title}" in "${r.club.name}"`, {
    bookTitle: nomination.title,
  });
  return { ok: true };
}

export async function removeNomination(
  db: D1Database,
  userId: number,
  clubId: number,
  nominationId: number,
): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "owner", "remove nominations");
  if (!r.ok) return r;
  const nomination = await nominationTitle(db, clubId, nominationId);
  if (!nomination) return notFound("Nomination not found");

  // A removal takes the book out entirely — votes on it are released, and
  // because the row is gone it can be nominated again like new. Unlike a
  // veto it isn't recorded anywhere (that's the point: it never belonged).
  await execute(db, "DELETE FROM club_votes WHERE nomination_id = ?", nominationId);
  await execute(db, "DELETE FROM club_nominations WHERE id = ?", nominationId);
  const owner = await usernameOf(db, userId);
  await notifyMembers(
    db,
    r.club,
    userId,
    "club_nomination_removed",
    `${owner} removed "${nomination.title}" from the vote in "${r.club.name}"`,
    { bookTitle: nomination.title },
  );
  return { ok: true };
}

// ---------- Stages: nominating -> voting (-> runoff) -> closed ----------

export async function closeVote(
  db: D1Database,
  userId: number,
  clubId: number,
): Promise<Result | (Failure & { runoffNeeded: true; runoffTitles: string[] })> {
  const r = await loadClub(db, userId, clubId, "owner", "close the vote");
  if (!r.ok) return r;
  const closed = votingClosed(r.club, "Voting is already closed");
  if (closed) return closed;

  // Vetoed nominations can't win — only active ones count.
  const nominations = await activeNominations(db, clubId);
  if (nominations.length === 0) {
    const anyVetoed = await queryOne(
      db,
      "SELECT 1 FROM club_nominations WHERE club_id = ? AND vetoed_by IS NOT NULL",
      clubId,
    );
    return fail(anyVetoed ? "Every nomination was vetoed" : "No nominations yet");
  }
  const { totalVotes, leaders, hasMajority } = tally(nominations);
  if (totalVotes === 0) return fail("No votes cast yet");
  if (!hasMajority) {
    const reason =
      leaders.length > 1
        ? `It's a tie between ${quoted(
            leaders.map((n) => n.title),
            " and ",
          )}`
        : `"${leaders[0].title}" leads with ${leaders[0].votes} of ${totalVotes} votes — short of a majority`;
    return {
      ...fail(`${reason} — start a runoff`),
      runoffNeeded: true,
      runoffTitles: runoffField(nominations).map((n) => n.title),
    };
  }

  const winner = leaders[0];
  await execute(db, "INSERT INTO club_picks (club_id, book_id) VALUES (?, ?)", clubId, winner.book_id);
  await clearAllVotes(db, clubId);
  await execute(db, "DELETE FROM club_nominations WHERE club_id = ?", clubId);
  await execute(db, "UPDATE clubs SET voting_open = 0, runoff = 0 WHERE id = ?", clubId);
  await notifyMembers(db, r.club, userId, "club_pick", `"${winner.title}" won the vote in "${r.club.name}"`, {
    bookId: winner.book_id,
    bookTitle: winner.title,
  });
  return { ok: true };
}

export async function startRunoff(db: D1Database, userId: number, clubId: number): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "owner", "start a runoff");
  if (!r.ok) return r;
  const closed = votingClosed(r.club);
  if (closed) return closed;

  const active = await activeNominations(db, clubId);
  const { totalVotes, leaders, hasMajority } = tally(active);
  if (totalVotes === 0) return fail("No votes cast yet");
  if (hasMajority) {
    return fail(
      `"${leaders[0].title}" already has a majority (${leaders[0].votes} of ${totalVotes} votes) — close the vote to pick it`,
    );
  }

  // Drop the also-rans and reset the votes on the runoff field so everyone
  // re-votes with the final field in view. Vetoed rows stay struck until the
  // vote closes.
  const field = runoffField(active);
  const ids = field.map((n) => n.id);
  const placeholders = ids.map(() => "?").join(",");
  await execute(
    db,
    `DELETE FROM club_nominations WHERE club_id = ? AND id NOT IN (${placeholders}) AND vetoed_by IS NULL`,
    clubId,
    ...ids,
  );
  await execute(db, `DELETE FROM club_votes WHERE nomination_id IN (${placeholders})`, ...ids);
  await execute(db, "UPDATE clubs SET runoff = 1 WHERE id = ?", clubId);

  const titles = field.map((n) => n.title);
  await notifyMembers(
    db,
    r.club,
    userId,
    "club_runoff",
    `Runoff in "${r.club.name}": ${quoted(titles, " vs ")} — vote again!`,
    { runoffTitles: titles },
  );
  return { ok: true };
}

// Closed -> nominating: the owner kicks off a new cycle.
export async function openNominations(db: D1Database, userId: number, clubId: number): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "owner", "start a new cycle");
  if (!r.ok) return r;
  if (r.club.voting_open === 1 || r.club.nominations_open === 1) return fail("A cycle is already in progress");
  await execute(db, "UPDATE clubs SET nominations_open = 1, voting_open = 0, runoff = 0 WHERE id = ?", clubId);
  await notifyMembers(
    db,
    r.club,
    userId,
    "club_nominations_open",
    `Nominations are open for the next book in "${r.club.name}"`,
  );
  return { ok: true };
}

// Nominating -> voting: the owner locks nominations and opens the vote.
export async function startVoting(db: D1Database, userId: number, clubId: number): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "owner", "open the vote");
  if (!r.ok) return r;
  if (r.club.nominations_open !== 1) return fail("The club is not in the nomination stage");
  if ((await activeNominations(db, clubId)).length === 0) {
    return fail("Nominate at least one book before opening the vote");
  }
  await execute(db, "UPDATE clubs SET nominations_open = 0, voting_open = 1 WHERE id = ?", clubId);
  await notifyMembers(db, r.club, userId, "club_voting_open", `Voting is open in "${r.club.name}" — cast your vote!`);
  return { ok: true };
}

// Voting -> nominating: the owner resets the vote (including a runoff) and
// reopens nominations. All cast votes are cleared; nominations and vetoes
// stay so the field can be adjusted before voting again.
export async function backToNominations(db: D1Database, userId: number, clubId: number): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "owner", "reset the vote");
  if (!r.ok) return r;
  if (r.club.voting_open !== 1) return fail("Voting is not open");
  await clearAllVotes(db, clubId);
  await execute(db, "UPDATE clubs SET nominations_open = 1, voting_open = 0, runoff = 0 WHERE id = ?", clubId);
  await notifyMembers(
    db,
    r.club,
    userId,
    "club_nominations_reset",
    `Voting was reset in "${r.club.name}" — back to nominations`,
  );
  return { ok: true };
}

// Cheap change detection for the live club stream: the string shifts any
// time something visible on the club page changes (club, stage, membership,
// roles, nominations, vetoes, votes, picks, runoff state). One query per check.
export async function getClubVersion(db: D1Database, clubId: number): Promise<string> {
  const row = await queryOne<{ c: string }>(
    db,
    `SELECT
       (SELECT COUNT(*) || '-' || COALESCE(MAX(runoff), 0) || '-' || COALESCE(MAX(voting_open), 0) || '-' ||
               COALESCE(MAX(nominations_open), 0) FROM clubs WHERE id = ?1) || '-' ||
       (SELECT COUNT(*) || '-' || COALESCE(SUM(role = 'owner'), 0) || '-' || COALESCE(SUM(status = 'accepted'), 0)
          FROM club_members WHERE club_id = ?1) || '-' ||
       (SELECT COUNT(*) || '-' || COUNT(vetoed_by) || '-' || COALESCE(MAX(created_at), 0)
          FROM club_nominations WHERE club_id = ?1) || '-' ||
       (SELECT COUNT(*) || '-' || COALESCE(MAX(v.created_at), 0)
          FROM club_votes v JOIN club_nominations n ON n.id = v.nomination_id WHERE n.club_id = ?1) || '-' ||
       (SELECT COUNT(*) FROM club_picks WHERE club_id = ?1)
     AS c`,
    clubId,
  );
  return row?.c ?? "";
}
