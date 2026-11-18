/**
 * Seeds the local preview server with test accounts and club data by talking
 * to the running API (default http://localhost:8788).
 *
 * Usage:
 *   1. bun run build && bun run migrate:local
 *   2. bun run dev            (wrangler pages dev on :8788)
 *   3. bun run seed:preview
 *
 * Safe to re-run: existing users are logged into, existing clubs are skipped.
 */
const BASE = process.env.BOOKRECS_URL ?? "http://localhost:8788";
const PASSWORD = "bookclub123";

interface Ctx {
  username: string;
  cookie: string;
}

async function call(path: string, init: RequestInit = {}, cookie?: string): Promise<{ ok: boolean; status: number; data: any; cookie?: string }> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  const setCookie = res.headers.get("set-cookie");
  return { ok: res.ok, status: res.status, data, cookie: setCookie ? setCookie.split(";")[0] : undefined };
}

async function signupOrLogin(username: string): Promise<Ctx> {
  const email = `${username}@bookrecs.test`;
  const signup = await call("/api/signup", {
    method: "POST",
    body: JSON.stringify({ username, email, password: PASSWORD }),
  });
  if (signup.ok && signup.cookie) {
    console.log(`  created ${username} (${email} / ${PASSWORD})`);
    return { username, cookie: signup.cookie };
  }
  if (signup.status === 409) {
    const login = await call("/api/login", {
      method: "POST",
      body: JSON.stringify({ usernameOrEmail: username, password: PASSWORD }),
    });
    if (!login.ok || !login.cookie) {
      throw new Error(
        `user "${username}" already exists but the seed password "${PASSWORD}" doesn't work — skipping.`
      );
    }
    console.log(`  logged in ${username} (existing account)`);
    return { username, cookie: login.cookie };
  }
  throw new Error(`signup failed for ${username}: ${JSON.stringify(signup.data)}`);
}

async function befriend(a: Ctx, b: Ctx): Promise<void> {
  // Sending the reverse request auto-accepts, so send both directions.
  await call("/api/friends/requests", {
    method: "POST",
    body: JSON.stringify({ usernameOrEmail: b.username }),
  }, a.cookie);
  await call("/api/friends/requests", {
    method: "POST",
    body: JSON.stringify({ usernameOrEmail: a.username }),
  }, b.cookie);
  console.log(`  ${a.username} <-> ${b.username} are friends`);
}

async function searchFirstHit(ctx: Ctx, q: string): Promise<{ key: string; year?: number; title: string } | null> {
  const r = await call(`/api/books/search?q=${encodeURIComponent(q)}`, {}, ctx.cookie);
  if (!r.ok || !r.data.results?.length) return null;
  const hit = r.data.results[0];
  return { key: hit.key, year: hit.year, title: hit.title };
}

async function nominate(ctx: Ctx, clubId: number, q: string): Promise<boolean> {
  const hit = await searchFirstHit(ctx, q);
  if (!hit) {
    console.log(`  ! could not find "${q}" on Open Library (offline?) — nomination skipped`);
    return false;
  }
  const r = await call(`/api/clubs/${clubId}/nominate`, {
    method: "POST",
    body: JSON.stringify({ ol_key: hit.key, year: hit.year }),
  }, ctx.cookie);
  if (r.ok) {
    console.log(`  ${ctx.username} nominated "${hit.title}"`);
    return true;
  }
  console.log(`  ! nominate "${hit.title}" failed: ${r.data.error}`);
  return false;
}

async function createClubIfMissing(owner: Ctx, name: string, invitees: Ctx[], description: string): Promise<number | null> {
  const list = await call("/api/clubs", {}, owner.cookie);
  const existing = list.data.clubs?.find((c: any) => c.name === name);
  if (existing) {
    console.log(`  club "${name}" already exists (#${existing.id}) — skipping`);
    return null;
  }
  const r = await call("/api/clubs", {
    method: "POST",
    body: JSON.stringify({
      name,
      description,
      usernames: invitees.map((c) => c.username),
    }),
  }, owner.cookie);
  if (!r.ok) throw new Error(`createClub("${name}") failed: ${JSON.stringify(r.data)}`);
  console.log(`  ${owner.username} created club "${name}" (#${r.data.club.id}), invited: ${r.data.invited.join(", ") || "nobody"}`);
  return r.data.club.id;
}

async function acceptInvite(ctx: Ctx, clubId: number): Promise<void> {
  const r = await call(`/api/clubs/${clubId}/respond`, {
    method: "POST",
    body: JSON.stringify({ accept: true }),
  }, ctx.cookie);
  if (r.ok) console.log(`  ${ctx.username} joined club #${clubId}`);
  else console.log(`  ! ${ctx.username} couldn't join club #${clubId}: ${r.data.error}`);
}

async function vote(ctx: Ctx, clubId: number, bookTitlePattern: string): Promise<void> {
  const d = await call(`/api/clubs/${clubId}`, {}, ctx.cookie);
  if (!d.ok) return;
  const nom = d.data.club.nominations.find((n: any) =>
    n.title.toLowerCase().includes(bookTitlePattern.toLowerCase())
  );
  if (!nom) {
    console.log(`  ! ${ctx.username} found no nomination matching "${bookTitlePattern}"`);
    return;
  }
  const r = await call(`/api/clubs/${clubId}/vote`, {
    method: "POST",
    body: JSON.stringify({ nominationId: nom.id }),
  }, ctx.cookie);
  if (r.ok) console.log(`  ${ctx.username} voted for "${nom.title}"`);
  else console.log(`  ! ${ctx.username} vote failed: ${r.data.error}`);
}

async function closeVote(ctx: Ctx, clubId: number): Promise<void> {
  const r = await call(`/api/clubs/${clubId}/close-vote`, { method: "POST" }, ctx.cookie);
  if (r.ok) console.log(`  vote closed — winner: "${r.data.pick?.title}"`);
  else console.log(`  ! close-vote failed: ${r.data.error}`);
}

async function main() {
  console.log(`\nSeeding preview data at ${BASE}\n`);

  // 1. Accounts
  console.log("Accounts:");
  const alice = await signupOrLogin("alice");
  const bob = await signupOrLogin("bob");
  const carol = await signupOrLogin("carol");
  const dave = await signupOrLogin("dave"); // no friends — demonstrates invite gating

  // 2. Friendships
  console.log("\nFriendships:");
  await befriend(alice, bob);
  await befriend(alice, carol);
  await befriend(bob, carol);

  // 3. Club 1 — mid-vote: bob's invite stays PENDING so you can accept it in the UI.
  console.log("\nClub 1 (vote in progress):");
  const sfId = await createClubIfMissing(
    alice,
    "SciFi & Fantasy Book Club",
    [bob, carol],
    "Spaceships, dragons, and the books between them."
  );
  if (sfId !== null) {
    await acceptInvite(carol, sfId); // bob stays pending on purpose
    await nominate(alice, sfId, "Dune Frank Herbert");
    await nominate(alice, sfId, "The Left Hand of Darkness");
    await nominate(carol, sfId, "Parable of the Sower");
    await vote(alice, sfId, "Dune");
    await vote(carol, sfId, "Parable");
    console.log(`  left as-is: bob's invite pending, vote tied 1-1 — log in as bob to accept and break the tie`);
  }

  // 4. Club 2 — a finished vote with a current read.
  console.log("\nClub 2 (pick already made):");
  const classicsId = await createClubIfMissing(
    alice,
    "Classics Club",
    [carol],
    "Old books, new friends."
  );
  if (classicsId !== null) {
    await acceptInvite(carol, classicsId);
    const n1 = await nominate(alice, classicsId, "Pride and Prejudice");
    const n2 = await nominate(alice, classicsId, "Frankenstein");
    if (n1 || n2) {
      await vote(alice, classicsId, "Pride");
      await vote(carol, classicsId, "Pride");
      await closeVote(alice, classicsId);
    }
  }

  console.log(`\nDone. Test accounts (password: ${PASSWORD}):
  alice — owns both clubs
  bob   — pending invite to "SciFi & Fantasy Book Club", friends with alice + carol
  carol — member of both clubs, has voted
  dave  — no friends (invite gating demo)

Try:
  1. Log in as bob / ${PASSWORD} → Clubs tab → accept the invite → vote on "SciFi & Fantasy Book Club"
  2. Log in as alice → close the vote → see the winner become the club's current read
  3. Log in as dave → try inviting dave anywhere (should be refused — not a friend)
`);
}

main().catch((e) => {
  console.error("\nSeed failed:", e.message);
  console.error("Is the preview server running? Start it with: bun run dev");
  process.exit(1);
});
