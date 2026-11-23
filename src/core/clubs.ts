import { execute, queryAll, queryOne } from "../db";
import { type BookRef, resolveBook } from "./books";
import { isFriend } from "./friends";
import { type MineStatus, viewerOwnership } from "./lists";
import { createNotification, markNotificationsRead } from "./notifications";
import { type Failure, fail, forbidden, notFound, type Result } from "./result";
import { findUser, type User, usernameOf } from "./users";

// nominating -> voting (-> runoff, a second round) -> closed -> nominating ...
type ClubStage = "nominating" | "voting" | "runoff" | "closed";

export interface ClubRow {
  id: number;
  name: string;
  description: string | null;
  creator_id: number;
  stage: ClubStage;
  created_at: number;
}

const isVoting = (club: { stage: ClubStage }) => club.stage === "voting" || club.stage === "runoff";

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
  vetoed_by: number | null;
  vetoedBy: string | null;
  eliminated: number;
  created_at: number;
}

interface ClubResultRow extends ClubNominationRow, Tally {
  mine: MineStatus;
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
  stage: ClubStage;
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
  stage: ClubStage;
  members: ClubMemberRow[];
  nominations: ClubNominationRow[];
  // Nomination ids, first choice first.
  myBallot: number[];
  // How many members have voted; the votes themselves stay hidden until the round closes.
  votedCount: number;
  myVetoUsed: boolean;
  currentPick: (ClubPickRow & { mine: MineStatus }) | null;
  pastPicks: ClubPickRow[];
}

const PICK_COLUMNS =
  "p.id, p.club_id, p.book_id, p.picked_at, b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual";

const NOMINATION_COLUMNS = `n.id, n.book_id, n.user_id, n.created_at, n.vetoed_by, n.eliminated,
    u.username AS nominatedBy,
    (SELECT username FROM users WHERE id = n.vetoed_by) AS vetoedBy,
    b.ol_key, b.title, b.author, b.cover_url, b.first_publish_year, b.manual`;

const NOMINATIONS_FROM =
  "FROM club_nominations n JOIN books b ON b.id = n.book_id JOIN users u ON u.id = n.user_id WHERE n.club_id = ?";

// Nominations still in the running (a runoff drops the rest), for the club ?1.
const IN_PLAY = "SELECT id FROM club_nominations WHERE club_id = ?1 AND pick_id IS NULL AND eliminated = 0";

const MAX_NOMINATIONS = 3;
const MAX_RANKED = 3;

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
  if (isVoting(club)) return null;
  return fail(club.stage === "nominating" ? "Voting hasn't opened yet — the club is still nominating" : closed);
}

async function clearVote(db: D1Database, clubId: number, userId: number): Promise<void> {
  await execute(
    db,
    `DELETE FROM club_votes WHERE user_id = ?2
       AND nomination_id IN (SELECT id FROM club_nominations WHERE club_id = ?1 AND pick_id IS NULL)`,
    clubId,
    userId,
  );
}

async function clearAllVotes(db: D1Database, clubId: number): Promise<void> {
  await execute(
    db,
    "DELETE FROM club_votes WHERE nomination_id IN (SELECT id FROM club_nominations WHERE club_id = ? AND pick_id IS NULL)",
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

interface Tally {
  points: number;
  firsts: number;
  seconds: number;
  thirds: number;
}

// A first choice is worth 3 points, a second 2 and a third 1.
const TALLY_COLUMNS = `(SELECT COALESCE(SUM(${MAX_RANKED + 1} - v.rank), 0) FROM club_votes v WHERE v.nomination_id = n.id) AS points,
    (SELECT COUNT(*) FROM club_votes v WHERE v.nomination_id = n.id AND v.rank = 1) AS firsts,
    (SELECT COUNT(*) FROM club_votes v WHERE v.nomination_id = n.id AND v.rank = 2) AS seconds,
    (SELECT COUNT(*) FROM club_votes v WHERE v.nomination_id = n.id AND v.rank = 3) AS thirds`;

async function tallyVotes(db: D1Database, clubId: number) {
  return await queryAll<Tally & { id: number; book_id: number; title: string }>(
    db,
    `SELECT n.id, n.book_id, b.title, ${TALLY_COLUMNS}
     FROM club_nominations n JOIN books b ON b.id = n.book_id
     WHERE n.id IN (${IN_PLAY}) AND n.vetoed_by IS NULL
     ORDER BY points DESC, firsts DESC, seconds DESC, n.created_at ASC, n.id ASC`,
    clubId,
  );
}

// Most points wins; equal points go to more first choices, then more second
// choices. Several leaders are a tie only a runoff can settle.
function leadersOf<T extends Tally>(tallied: T[]): T[] {
  const [top] = tallied;
  return tallied.filter((n) => n.points === top.points && n.firsts === top.firsts && n.seconds === top.seconds);
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
    "INSERT INTO clubs (name, description, creator_id) VALUES (?, ?, ?) RETURNING *",
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
    `SELECT c.id, c.name, c.description, c.stage, c.created_at, m.role,
       (SELECT COUNT(*) FROM club_members cm WHERE cm.club_id = c.id AND cm.status = 'accepted') AS memberCount,
       (SELECT COUNT(*) FROM club_members cm WHERE cm.club_id = c.id AND cm.status = 'pending') AS invitedCount,
       (SELECT COUNT(*) FROM club_nominations n WHERE n.club_id = c.id AND n.pick_id IS NULL) AS nominationCount
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
  const nominations = await queryAll<ClubNominationRow>(
    db,
    `SELECT ${NOMINATION_COLUMNS} ${NOMINATIONS_FROM} AND n.pick_id IS NULL ORDER BY n.created_at ASC, n.id ASC`,
    clubId,
  );
  const votes = await queryAll<{ nomination_id: number; user_id: number }>(
    db,
    `SELECT nomination_id, user_id FROM club_votes WHERE nomination_id IN (${IN_PLAY}) ORDER BY rank ASC`,
    clubId,
  );
  const picks = await queryAll<ClubPickRow>(
    db,
    `SELECT ${PICK_COLUMNS} FROM club_picks p JOIN books b ON b.id = p.book_id
     WHERE p.club_id = ? ORDER BY p.picked_at DESC, p.id DESC`,
    clubId,
  );
  const [pick, ...pastPicks] = picks;
  const mine = await viewerOwnership(db, userId);

  return {
    ok: true,
    club: {
      club,
      myRole: membership.role,
      stage: club.stage,
      members,
      nominations,
      myBallot: votes.filter((v) => v.user_id === userId).map((v) => v.nomination_id),
      votedCount: new Set(votes.map((v) => v.user_id)).size,
      myVetoUsed: nominations.some((n) => n.vetoed_by === userId),
      currentPick: pick ? { ...pick, mine: mine(pick.book_id) } : null,
      pastPicks,
    },
  };
}

// A closed round, best result first. Picks from before ballots were kept have no nominations.
export async function getClubResults(
  db: D1Database,
  userId: number,
  clubId: number,
  pickId: number,
): Promise<Result<{ voters: number; nominations: ClubResultRow[] }>> {
  const r = await loadClub(db, userId, clubId, "member");
  if (!r.ok) return r;
  if (!(await queryOne(db, "SELECT 1 FROM club_picks WHERE id = ? AND club_id = ?", pickId, clubId))) {
    return notFound("Results not found");
  }
  const rows = await queryAll<Omit<ClubResultRow, "mine">>(
    db,
    `SELECT ${NOMINATION_COLUMNS}, ${TALLY_COLUMNS} ${NOMINATIONS_FROM} AND n.pick_id = ?
     ORDER BY n.vetoed_by IS NOT NULL, n.eliminated, points DESC, firsts DESC, seconds DESC, n.created_at, n.id`,
    clubId,
    pickId,
  );
  const voters = await queryOne<{ c: number }>(
    db,
    `SELECT COUNT(DISTINCT v.user_id) AS c FROM club_votes v JOIN club_nominations n ON n.id = v.nomination_id
     WHERE n.pick_id = ?`,
    pickId,
  );
  const mine = await viewerOwnership(db, userId);
  return {
    ok: true,
    voters: voters?.c ?? 0,
    nominations: rows.map((n) => ({ ...n, mine: mine(n.book_id) })),
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
  if (r.club.stage !== "nominating") {
    return fail(
      isVoting(r.club) ? "Nominations are closed while voting is open" : "Nominations are closed for the current pick",
    );
  }
  const b = await resolveBook(db, ref);
  if (!b.ok) return b;
  const open = await queryAll<{ book_id: number; user_id: number }>(
    db,
    "SELECT book_id, user_id FROM club_nominations WHERE club_id = ? AND pick_id IS NULL",
    clubId,
  );
  if (open.some((n) => n.book_id === b.book.id)) return fail("That book is already nominated");
  if (open.filter((n) => n.user_id === userId).length >= MAX_NOMINATIONS) {
    return fail(`You've used all ${MAX_NOMINATIONS} of your nominations`);
  }

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

// Replaces the member's ballot: nomination ids, first choice first.
export async function castBallot(db: D1Database, userId: number, clubId: number, ballot: number[]): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "member");
  if (!r.ok) return r;
  const closed = votingClosed(r.club);
  if (closed) return closed;
  if (ballot.length > MAX_RANKED) return fail(`Rank up to ${MAX_RANKED} books`);
  if (new Set(ballot).size !== ballot.length) return fail("Rank each book once");
  for (const id of ballot) {
    const nomination = await nominationTitle(db, clubId, id);
    if (!nomination) return notFound("Nomination not found");
    if (nomination.vetoed_by != null) return fail(`"${nomination.title}" was vetoed`);
  }

  await db.batch([
    db.prepare(`DELETE FROM club_votes WHERE user_id = ?2 AND nomination_id IN (${IN_PLAY})`).bind(clubId, userId),
    ...ballot.map((id, i) =>
      db.prepare("INSERT INTO club_votes (nomination_id, user_id, rank) VALUES (?, ?, ?)").bind(id, userId, i + 1),
    ),
  ]);
  return { ok: true };
}

async function nominationTitle(db: D1Database, clubId: number, nominationId: number) {
  return await queryOne<{ title: string; vetoed_by: number | null; user_id: number }>(
    db,
    `SELECT b.title, n.vetoed_by, n.user_id FROM club_nominations n JOIN books b ON b.id = n.book_id
     WHERE n.id = ?2 AND n.id IN (${IN_PLAY})`,
    clubId,
    nominationId,
  );
}

// Takes a book off every ballot, moving each voter's later choices up.
async function releaseVotes(db: D1Database, clubId: number, nominationId: number): Promise<void> {
  await execute(
    db,
    `UPDATE club_votes SET rank = rank - 1
     WHERE nomination_id IN (${IN_PLAY})
       AND rank > (SELECT x.rank FROM club_votes x WHERE x.nomination_id = ?2 AND x.user_id = club_votes.user_id)`,
    clubId,
    nominationId,
  );
  await execute(db, "DELETE FROM club_votes WHERE nomination_id = ?", nominationId);
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

  // One veto per member per round.
  const used = await queryOne(
    db,
    "SELECT 1 FROM club_nominations WHERE club_id = ? AND pick_id IS NULL AND vetoed_by = ?",
    clubId,
    userId,
  );
  if (used) return fail("You've already used your veto for this vote");

  await execute(db, "UPDATE club_nominations SET vetoed_by = ? WHERE id = ?", userId, nominationId);
  await releaseVotes(db, clubId, nominationId);
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
  const r = await loadClub(db, userId, clubId, "member");
  if (!r.ok) return r;
  const nomination = await nominationTitle(db, clubId, nominationId);
  if (!nomination) return notFound("Nomination not found");
  const withdrawing = nomination.user_id === userId && r.club.stage === "nominating" && nomination.vetoed_by == null;
  if (r.membership.role !== "owner" && !withdrawing) {
    return forbidden("Only the club owner can remove nominations");
  }

  // A removal takes the book out entirely — votes on it are released, and
  // because the row is gone it can be nominated again like new. Unlike a
  // veto it isn't recorded anywhere (that's the point: it never belonged).
  await releaseVotes(db, clubId, nominationId);
  await execute(db, "DELETE FROM club_nominations WHERE id = ?", nominationId);
  const remover = await usernameOf(db, userId);
  await notifyMembers(
    db,
    r.club,
    userId,
    "club_nomination_removed",
    `${remover} ${withdrawing ? "withdrew" : "removed"} "${nomination.title}" from the vote in "${r.club.name}"`,
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

  const tallied = await tallyVotes(db, clubId);
  if (tallied.length === 0) {
    const anyVetoed = await queryOne(
      db,
      "SELECT 1 FROM club_nominations WHERE club_id = ? AND pick_id IS NULL AND vetoed_by IS NOT NULL",
      clubId,
    );
    return fail(anyVetoed ? "Every nomination was vetoed" : "No nominations yet");
  }
  if (tallied[0].points === 0) return fail("No votes cast yet");
  const leaders = leadersOf(tallied);
  if (leaders.length > 1) {
    const runoffTitles = leaders.map((n) => n.title);
    return {
      ...fail(`It's a tie between ${quoted(runoffTitles, " and ")} — start a runoff`),
      runoffNeeded: true,
      runoffTitles,
    };
  }

  const [winner] = leaders;
  const pick = await queryOne<{ id: number }>(
    db,
    "INSERT INTO club_picks (club_id, book_id) VALUES (?, ?) RETURNING id",
    clubId,
    winner.book_id,
  );
  if (!pick) return fail("Could not close the vote");
  await db.batch([
    db.prepare("UPDATE club_nominations SET pick_id = ? WHERE club_id = ? AND pick_id IS NULL").bind(pick.id, clubId),
    db.prepare("UPDATE clubs SET stage = 'closed' WHERE id = ?").bind(clubId),
  ]);
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

  const tallied = await tallyVotes(db, clubId);
  if (tallied.length === 0 || tallied[0].points === 0) return fail("No votes cast yet");
  const leaders = leadersOf(tallied);
  if (leaders.length === 1) return fail("There's no tie — close the vote to pick the winner");

  // The rest drop out but keep their votes for the results; the tied books
  // start over. Vetoed rows stay as they are.
  const ids = leaders.map((n) => n.id);
  const placeholders = ids.map(() => "?").join(",");
  await execute(
    db,
    `UPDATE club_nominations SET eliminated = 1
     WHERE club_id = ? AND pick_id IS NULL AND vetoed_by IS NULL AND id NOT IN (${placeholders})`,
    clubId,
    ...ids,
  );
  await execute(db, `DELETE FROM club_votes WHERE nomination_id IN (${placeholders})`, ...ids);
  await execute(db, "UPDATE clubs SET stage = 'runoff' WHERE id = ?", clubId);

  const titles = leaders.map((n) => n.title);
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
  if (r.club.stage !== "closed") return fail("A cycle is already in progress");
  await execute(db, "UPDATE clubs SET stage = 'nominating' WHERE id = ?", clubId);
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
  if (r.club.stage !== "nominating") return fail("The club is not in the nomination stage");
  if ((await tallyVotes(db, clubId)).length === 0) {
    return fail("Nominate at least one book before opening the vote");
  }
  await execute(db, "UPDATE clubs SET stage = 'voting' WHERE id = ?", clubId);
  await notifyMembers(db, r.club, userId, "club_voting_open", `Voting is open in "${r.club.name}" — cast your vote!`);
  return { ok: true };
}

// Voting -> nominating: the owner resets the vote (including a runoff) and
// reopens nominations. All cast votes are cleared; nominations and vetoes
// stay (runoff also-rans return) so the field can be adjusted before voting again.
export async function backToNominations(db: D1Database, userId: number, clubId: number): Promise<Result> {
  const r = await loadClub(db, userId, clubId, "owner", "reset the vote");
  if (!r.ok) return r;
  if (!isVoting(r.club)) return fail("Voting is not open");
  await clearAllVotes(db, clubId);
  await execute(db, "UPDATE club_nominations SET eliminated = 0 WHERE club_id = ? AND pick_id IS NULL", clubId);
  await execute(db, "UPDATE clubs SET stage = 'nominating' WHERE id = ?", clubId);
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
// roles, nominations, vetoes, votes, picks). One query per check.
export async function getClubVersion(db: D1Database, clubId: number): Promise<string> {
  const row = await queryOne<{ c: string }>(
    db,
    `SELECT
       (SELECT COUNT(*) || '-' || COALESCE(MAX(stage), '') FROM clubs WHERE id = ?1) || '-' ||
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
