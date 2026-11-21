import { beforeEach, describe, expect, test } from "bun:test";
import { handleApi } from "./api";
import { createTestDb } from "./test/d1";

let db: D1Database;

async function call(cookie: string | undefined, method: string, path: string, body?: unknown) {
  const res = await handleApi(
    db,
    new Request(`http://test${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  // biome-ignore lint/suspicious/noExplicitAny: response bodies vary per route
  const data: any = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

function as(cookie: string) {
  return {
    get: (path: string) => call(cookie, "GET", path),
    post: (path: string, body: unknown = {}) => call(cookie, "POST", path, body),
    patch: (path: string, body: unknown) => call(cookie, "PATCH", path, body),
    del: (path: string) => call(cookie, "DELETE", path),
  };
}

async function signup(username: string) {
  const r = await call(undefined, "POST", "/api/signup", {
    username,
    email: `${username}@test.dev`,
    password: "password123",
  });
  expect(r.status).toBe(200);
  return { ...as(r.cookie ?? ""), id: r.data.user.id as number };
}

async function befriend(a: Awaited<ReturnType<typeof signup>>, b: Awaited<ReturnType<typeof signup>>, bName: string) {
  await a.post("/api/friends/requests", { usernameOrEmail: bName });
  const { data } = await b.get("/api/friends/requests");
  await b.post(`/api/friends/requests/${data.incoming[0].id}/accept`);
}

const manual = (title: string) => ({ title, author: "Author", year: "2000", coverUrl: "", public: true });
const titles = (books: { title: string }[]) => books.map((b) => b.title);

beforeEach(() => {
  db = createTestDb();
});

describe("auth", () => {
  test("signup, me, login and logout return the same user shape", async () => {
    const alice = await signup("alice");
    const me = await alice.get("/api/me");
    expect(me.data.user).toMatchObject({ username: "alice", bookLimit: 25, discoverable: true });

    const bad = await call(undefined, "POST", "/api/login", { usernameOrEmail: "alice", password: "wrong-pass" });
    expect(bad.status).toBe(401);

    const login = await call(undefined, "POST", "/api/login", { usernameOrEmail: "alice", password: "password123" });
    expect(login.data.user).toMatchObject({ username: "alice", bookLimit: 25, discoverable: true });
    expect(login.cookie).toMatch(/^session=\w+/);

    await as(login.cookie ?? "").post("/api/logout");
    expect((await as(login.cookie ?? "").get("/api/me")).data.user).toBeNull();
  });

  test("the session cookie is Lax so other sites can't send it on POSTs", async () => {
    const res = await handleApi(
      db,
      new Request("http://test/api/signup", {
        method: "POST",
        body: JSON.stringify({ username: "alice", email: "a@test.dev", password: "password123" }),
      }),
    );
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=2592000");
  });

  test("protected routes require a session", async () => {
    expect((await call(undefined, "GET", "/api/me/books")).status).toBe(401);
  });

  test("an API token authenticates as a bearer", async () => {
    const alice = await signup("alice");
    const { data } = await alice.post("/api/token");
    const res = await handleApi(
      db,
      new Request("http://test/api/me/books", { headers: { authorization: `Bearer ${data.token}` } }),
    );
    expect(res.status).toBe(200);
  });
});

describe("ranked lists", () => {
  test("adding, reordering, re-ranking and removing keeps ranks contiguous", async () => {
    const alice = await signup("alice");
    for (const t of ["A", "B", "C"]) await alice.post("/api/books/manual", manual(t));
    let books = (await alice.get("/api/me/books")).data.books;
    expect(titles(books)).toEqual(["A", "B", "C"]);

    const ids = Object.fromEntries(books.map((b: { title: string; book_id: number }) => [b.title, b.book_id]));
    await alice.post("/api/me/books/reorder", { ordered: [ids.C, ids.A, ids.B] });
    await alice.patch(`/api/me/books/${ids.B}`, { rank: 1 });
    books = (await alice.del(`/api/me/books/${ids.C}`)).data.books;
    expect(titles(books)).toEqual(["B", "A"]);
    expect(books.map((b: { rank: number }) => b.rank)).toEqual([1, 2]);
  });

  test("the book limit blocks adding more reads", async () => {
    const alice = await signup("alice");
    await db.prepare("UPDATE users SET book_limit = 1 WHERE id = ?").bind(alice.id).run();
    expect((await alice.post("/api/books/manual", manual("A"))).status).toBe(200);
    const r = await alice.post("/api/books/manual", manual("B"));
    expect(r.status).toBe(400);
    expect(r.data.error).toContain("maximum of 1");
  });

  test("wishlist -> reading -> back to wishlist restores rank and owned", async () => {
    const alice = await signup("alice");
    for (const t of ["W1", "W2", "W3"]) await alice.post("/api/me/wishlist/manual", manual(t));
    const wish = (await alice.get("/api/me/wishlist")).data.books;
    const w2 = wish[1].book_id;
    await alice.post(`/api/me/wishlist/${w2}/owned`, { owned: true });

    await alice.post("/api/me/reading/from-wishlist", { book_id: w2 });
    expect(titles((await alice.get("/api/me/wishlist")).data.books)).toEqual(["W1", "W3"]);
    expect(titles((await alice.get("/api/me/reading")).data.books)).toEqual(["W2"]);

    await alice.post(`/api/me/reading/${w2}/back-to-wishlist`);
    const restored = (await alice.get("/api/me/wishlist")).data.books;
    expect(titles(restored)).toEqual(["W1", "W2", "W3"]);
    expect(restored[1].owned).toBe(1);
  });

  test("finishing a book moves it to reads", async () => {
    const alice = await signup("alice");
    const { data } = await alice.post("/api/me/reading/manual", manual("R"));
    await alice.post(`/api/me/reading/${data.book.id}/finish`);
    expect(titles((await alice.get("/api/me/books")).data.books)).toEqual(["R"]);
    expect((await alice.get("/api/me/reading")).data.books).toEqual([]);
  });
});

describe("friends", () => {
  test("friends see each other's public books; strangers get 403", async () => {
    const alice = await signup("alice");
    const bob = await signup("bob");
    const carol = await signup("carol");
    await alice.post("/api/books/manual", manual("Public"));
    await alice.post("/api/books/manual", { ...manual("Private"), public: false });
    await befriend(alice, bob, "bob");

    expect(titles((await bob.get("/api/friends/alice/books")).data.books)).toEqual(["Public"]);
    expect((await carol.get("/api/friends/alice/books")).status).toBe(403);
    expect((await carol.get("/api/friends/nobody/books")).status).toBe(404);
  });

  test("book detail lists friend activity", async () => {
    const alice = await signup("alice");
    const bob = await signup("bob");
    await befriend(alice, bob, "bob");
    const { data } = await alice.post("/api/books/manual", manual("Shared"));
    await bob.post("/api/me/wishlist", { book_id: data.book.id, public: true });
    const detail = (await alice.get(`/api/books/${data.book.id}`)).data.book;
    expect(detail.friends).toEqual([expect.objectContaining({ username: "bob", status: "wishlist" })]);
  });
});

describe("clubs", () => {
  async function clubWithMembers() {
    const alice = await signup("alice");
    const bob = await signup("bob");
    const carol = await signup("carol");
    await befriend(alice, bob, "bob");
    await befriend(alice, carol, "carol");
    const { data } = await alice.post("/api/clubs", { name: "Club", usernames: ["bob", "carol"] });
    const clubId = data.club.id as number;
    await bob.post(`/api/clubs/${clubId}/respond`, { accept: true });
    await carol.post(`/api/clubs/${clubId}/respond`, { accept: true });
    const books: number[] = [];
    for (const t of ["X", "Y", "Z"]) books.push((await alice.post("/api/books/manual", manual(t))).data.book.id);
    return { alice, bob, carol, clubId, books };
  }

  async function nominations(user: ReturnType<typeof as>, clubId: number) {
    return (await user.get(`/api/clubs/${clubId}`)).data.club.nominations as { id: number; title: string }[];
  }

  test("a majority closes the vote and becomes the current pick", async () => {
    const { alice, bob, carol, clubId, books } = await clubWithMembers();
    for (const id of books.slice(0, 2)) await alice.post(`/api/clubs/${clubId}/nominate`, { book_id: id });
    await alice.post(`/api/clubs/${clubId}/start-voting`);
    const [x] = await nominations(alice, clubId);
    for (const u of [alice, bob]) await u.post(`/api/clubs/${clubId}/vote`, { nominationId: x.id });

    expect((await carol.post(`/api/clubs/${clubId}/close-vote`)).status).toBe(403);
    expect((await alice.post(`/api/clubs/${clubId}/close-vote`)).status).toBe(200);
    const club = (await alice.get(`/api/clubs/${clubId}`)).data.club;
    expect(club.currentPick.title).toBe("X");
    expect(club.votingOpen).toBe(false);
  });

  test("a tie needs a runoff, which then resolves", async () => {
    const { alice, bob, carol, clubId, books } = await clubWithMembers();
    for (const id of books) await alice.post(`/api/clubs/${clubId}/nominate`, { book_id: id });
    await alice.post(`/api/clubs/${clubId}/start-voting`);
    const [x, y] = await nominations(alice, clubId);
    await alice.post(`/api/clubs/${clubId}/vote`, { nominationId: x.id });
    await bob.post(`/api/clubs/${clubId}/vote`, { nominationId: y.id });

    const tie = await alice.post(`/api/clubs/${clubId}/close-vote`);
    expect(tie.status).toBe(400);
    expect(tie.data.runoffNeeded).toBe(true);

    await alice.post(`/api/clubs/${clubId}/runoff`);
    expect(titles(await nominations(alice, clubId))).toEqual(["X", "Y"]);
    for (const u of [alice, carol]) await u.post(`/api/clubs/${clubId}/vote`, { nominationId: y.id });
    expect((await alice.post(`/api/clubs/${clubId}/close-vote`)).status).toBe(200);
    expect((await alice.get(`/api/clubs/${clubId}`)).data.club.currentPick.title).toBe("Y");
  });

  test("stages gate nominating and voting", async () => {
    const { alice, bob, clubId, books } = await clubWithMembers();
    await alice.post(`/api/clubs/${clubId}/nominate`, { book_id: books[0] });
    const [x] = await nominations(alice, clubId);
    expect((await bob.post(`/api/clubs/${clubId}/vote`, { nominationId: x.id })).status).toBe(400);
    expect((await bob.post(`/api/clubs/${clubId}/start-voting`)).status).toBe(403);
    await alice.post(`/api/clubs/${clubId}/start-voting`);
    expect((await bob.post(`/api/clubs/${clubId}/nominate`, { book_id: books[1] })).status).toBe(400);
  });

  test("vetoes release votes and are one per member", async () => {
    const { alice, bob, clubId, books } = await clubWithMembers();
    for (const id of books.slice(0, 2)) await alice.post(`/api/clubs/${clubId}/nominate`, { book_id: id });
    await alice.post(`/api/clubs/${clubId}/start-voting`);
    const [x, y] = await nominations(alice, clubId);
    await alice.post(`/api/clubs/${clubId}/vote`, { nominationId: x.id });
    expect((await bob.post(`/api/clubs/${clubId}/veto`, { nominationId: x.id })).status).toBe(200);
    expect((await bob.post(`/api/clubs/${clubId}/veto`, { nominationId: y.id })).status).toBe(400);
    const club = (await alice.get(`/api/clubs/${clubId}`)).data.club;
    expect(club.myVote).toBeNull();
  });

  test("non-members can't see a club; a missing club is 404", async () => {
    const { clubId } = await clubWithMembers();
    const dave = await signup("dave");
    expect((await dave.get(`/api/clubs/${clubId}`)).status).toBe(403);
    expect((await dave.get("/api/clubs/999")).status).toBe(404);
  });
});

describe("notifications", () => {
  test("club activity groups, and opening the panel leaves only pending actions unread", async () => {
    const alice = await signup("alice");
    const bob = await signup("bob");
    const carol = await signup("carol");
    await befriend(alice, bob, "bob");
    const { data } = await alice.post("/api/clubs", { name: "Club", usernames: ["bob"] });
    await bob.post(`/api/clubs/${data.club.id}/respond`, { accept: true });
    for (const t of ["N1", "N2"]) {
      const book = (await bob.post("/api/books/manual", manual(t))).data.book;
      await bob.post(`/api/clubs/${data.club.id}/nominate`, { book_id: book.id });
    }
    await carol.post("/api/friends/requests", { usernameOrEmail: "alice" });

    const before = (await alice.get("/api/notifications")).data;
    const nominationGroup = before.notifications.find((n: { type: string }) => n.type === "club_nominations");
    expect(nominationGroup.ids).toHaveLength(2);

    const after = (await alice.post("/api/notifications/seen")).data;
    expect(after.unreadCount).toBe(1);
    expect(after.notifications[0]).toMatchObject({ type: "friend_request", actionable: true });
  });
});
