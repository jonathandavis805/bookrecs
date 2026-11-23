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

  test("the theme is saved to the account and returned with the user", async () => {
    const alice = await signup("alice");
    expect((await alice.get("/api/me")).data.user.theme).toBeNull();

    const theme = { preset: "gruvbox", font: "mono" };
    expect((await alice.post("/api/me/theme", { theme })).status).toBe(200);
    expect((await alice.get("/api/me")).data.user.theme).toEqual(theme);

    expect((await alice.post("/api/me/theme", { theme: "gruvbox" })).status).toBe(400);
    expect((await alice.post("/api/me/theme", { theme: { junk: "x".repeat(5000) } })).status).toBe(400);
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

describe("categories", () => {
  async function shelf() {
    const alice = await signup("alice");
    const ids: Record<string, number> = {};
    for (const t of ["Dune", "Emma", "Foundation", "Gatsby", "Hyperion"]) {
      ids[t] = (await alice.post("/api/books/manual", manual(t))).data.book.id;
    }
    const scifi = (await alice.post("/api/me/categories", { name: "Sci-fi" })).data.category.id;
    for (const t of ["Dune", "Foundation", "Hyperion"]) {
      await alice.post(`/api/me/books/${ids[t]}/categories`, { category_ids: [scifi] });
    }
    return { alice, ids, scifi };
  }

  test("reordering a category moves only its books, within the slots they held", async () => {
    const { alice, ids, scifi } = await shelf();
    const { data } = await alice.post(`/api/me/categories/${scifi}/reorder`, { ordered: [ids.Hyperion] });
    expect(titles(data.books)).toEqual(["Hyperion", "Emma", "Dune", "Gatsby", "Foundation"]);
    expect(data.books.map((b: { rank: number }) => b.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  test("global reorder carries into the category; removing a read or deleting a category cleans up", async () => {
    const { alice, ids, scifi } = await shelf();
    await alice.post("/api/me/books/reorder", { ordered: [ids.Foundation] });
    let books = (await alice.get("/api/me/books")).data.books;
    const inScifi = (bs: { title: string; category_ids: number[] }[]) =>
      titles(bs.filter((b) => b.category_ids.includes(scifi)));
    expect(inScifi(books)).toEqual(["Foundation", "Dune", "Hyperion"]);

    books = (await alice.del(`/api/me/books/${ids.Dune}`)).data.books;
    expect(inScifi(books)).toEqual(["Foundation", "Hyperion"]);

    expect((await alice.del(`/api/me/categories/${scifi}`)).data.categories).toEqual([]);
    books = (await alice.get("/api/me/books")).data.books;
    expect(titles(books)).toEqual(["Foundation", "Emma", "Gatsby", "Hyperion"]);
    expect(books.every((b: { category_ids: number[] }) => b.category_ids.length === 0)).toBe(true);
  });

  test("names are unique per user ignoring case, and other users' categories are off limits", async () => {
    const { alice, ids, scifi } = await shelf();
    expect((await alice.post("/api/me/categories", { name: " sci-FI " })).status).toBe(400);
    expect((await alice.post("/api/me/categories", { name: "  " })).status).toBe(400);
    expect((await alice.patch(`/api/me/categories/${scifi}`, { name: "SCI-FI" })).status).toBe(200);

    const bob = await signup("bob");
    expect((await bob.post("/api/me/categories", { name: "Sci-fi" })).status).toBe(200);
    expect((await bob.del(`/api/me/categories/${scifi}`)).status).toBe(404);
    expect((await bob.post(`/api/me/categories/${scifi}/reorder`, { ordered: [] })).status).toBe(404);

    const { data } = await bob.post("/api/books/manual", { ...manual("Bob's"), category_ids: [scifi] });
    expect(data.books[0].category_ids).toEqual([]);
    expect((await bob.post(`/api/me/books/${ids.Dune}/categories`, { category_ids: [] })).status).toBe(404);
  });

  test("categories follow a book from wishlist to reading and back, and go once it is on no list", async () => {
    const { alice, ids, scifi } = await shelf();
    const id = ids.Dune;
    await alice.post("/api/me/reading", { book_id: id });
    await alice.del(`/api/me/books/${id}`);
    await alice.del(`/api/me/reading/${id}`);
    await alice.post("/api/me/wishlist", { book_id: id });
    const on = async (list: string) => (await alice.get(`/api/me/${list}`)).data.books[0]?.category_ids;
    expect(await on("wishlist")).toEqual([]);

    await alice.post(`/api/me/books/${id}/categories`, { category_ids: [scifi] });
    expect(await on("wishlist")).toEqual([scifi]);
    await alice.post("/api/me/reading/from-wishlist", { book_id: id });
    expect(await on("reading")).toEqual([scifi]);
    await alice.post(`/api/me/reading/${id}/back-to-wishlist`);
    expect(await on("wishlist")).toEqual([scifi]);
    await alice.post("/api/me/reading/from-wishlist", { book_id: id });
    await alice.del(`/api/me/reading/${id}`);
    expect(await on("wishlist")).toEqual([scifi]);
    await alice.post("/api/me/reading/from-wishlist", { book_id: id });
    await alice.post(`/api/me/reading/${id}/finish`);
    const { books } = (await alice.get("/api/me/books")).data;
    expect(books.find((b: { book_id: number }) => b.book_id === id).category_ids).toEqual([scifi]);
  });

  test("starting a wishlist book takes it off the wishlist, keeping its categories and place", async () => {
    const { alice, ids, scifi } = await shelf();
    for (const t of ["Dune", "Emma"]) {
      await alice.del(`/api/me/books/${ids[t]}`);
      await alice.post("/api/me/wishlist", { book_id: ids[t] });
    }
    await alice.post(`/api/me/books/${ids.Dune}/categories`, { category_ids: [scifi] });

    const { data } = await alice.post("/api/me/reading", { book_id: ids.Dune });
    expect(data.books[0].category_ids).toEqual([scifi]);
    expect(titles((await alice.get("/api/me/wishlist")).data.books)).toEqual(["Emma"]);
    await alice.post(`/api/me/reading/${ids.Dune}/back-to-wishlist`);
    expect(titles((await alice.get("/api/me/wishlist")).data.books)).toEqual(["Dune", "Emma"]);
  });

  test("friends see categories used only on a public wishlist item", async () => {
    const { alice, ids } = await shelf();
    const later = (await alice.post("/api/me/categories", { name: "Later" })).data.category.id;
    await alice.del(`/api/me/books/${ids.Emma}`);
    await alice.post("/api/me/wishlist", { book_id: ids.Emma, public: false });
    await alice.post(`/api/me/books/${ids.Emma}/categories`, { category_ids: [later] });

    const bob = await signup("bob");
    await befriend(alice, bob, "bob");
    const names = async () =>
      (await bob.get("/api/friends/alice/books")).data.categories.map((c: { name: string }) => c.name);
    expect(await names()).toEqual(["Sci-fi"]);
    await alice.post(`/api/me/wishlist/${ids.Emma}/public`, { public: true });
    expect(await names()).toEqual(["Later", "Sci-fi"]);
  });

  test("friends see categories with public books, holding only public books", async () => {
    const { alice, ids, scifi } = await shelf();
    const hidden = (await alice.post("/api/me/categories", { name: "Hidden" })).data.category.id;
    await alice.post(`/api/me/books/${ids.Emma}/categories`, { category_ids: [hidden] });
    await alice.post(`/api/me/books/${ids.Emma}/public`, { public: false });
    await alice.post(`/api/me/books/${ids.Dune}/public`, { public: false });

    const bob = await signup("bob");
    await befriend(alice, bob, "bob");
    const { data } = await bob.get("/api/friends/alice/books");
    expect(data.categories).toEqual([{ id: scifi, name: "Sci-fi" }]);
    expect(titles(data.books.filter((b: { category_ids: number[] }) => b.category_ids.includes(scifi)))).toEqual([
      "Foundation",
      "Hyperion",
    ]);
  });
});

describe("listened", () => {
  test("a read can be marked listened, and friends see the flag", async () => {
    const alice = await signup("alice");
    const id = (await alice.post("/api/books/manual", manual("Dune"))).data.book.id;
    expect((await alice.get("/api/me/books")).data.books[0].listened).toBe(0);

    const { data } = await alice.post(`/api/me/books/${id}/listened`, { listened: true });
    expect(data.books[0].listened).toBe(1);

    const bob = await signup("bob");
    expect((await bob.post(`/api/me/books/${id}/listened`, { listened: true })).status).toBe(404);
    await befriend(alice, bob, "bob");
    expect((await bob.get("/api/friends/alice/books")).data.books[0].listened).toBe(1);
  });

  test("a book being listened to is finished as listened", async () => {
    const alice = await signup("alice");
    const id = (await alice.post("/api/me/reading/manual", manual("Dune"))).data.book.id;
    expect((await alice.post("/api/me/reading/999/listening", { listening: true })).status).toBe(404);
    const { data } = await alice.post(`/api/me/reading/${id}/listening`, { listening: true });
    expect(data.books[0].listening).toBe(1);

    await alice.post(`/api/me/reading/${id}/finish`);
    expect((await alice.get("/api/me/books")).data.books[0].listened).toBe(1);
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

  test("wishlist items are public unless marked private", async () => {
    const alice = await signup("alice");
    const a = (await alice.post("/api/books/manual", manual("A"))).data.book.id;
    const b = (await alice.post("/api/books/manual", manual("B"))).data.book.id;
    await alice.del(`/api/me/books/${a}`);
    await alice.del(`/api/me/books/${b}`);
    await alice.post("/api/me/wishlist", { book_id: a });
    const { data } = await alice.post("/api/me/wishlist", { book_id: b, public: false });
    expect(data.books.map((w: { public: number }) => w.public)).toEqual([1, 0]);
  });

  test("book detail shows which of my lists the book is on", async () => {
    const alice = await signup("alice");
    const { data } = await alice.post("/api/books/manual", { ...manual("Mine"), review: "Loved it" });
    await alice.post("/api/me/reading", { book_id: data.book.id });
    const { mine } = (await alice.get(`/api/books/${data.book.id}`)).data.book;
    expect(mine).toEqual({
      read: { rank: 1, review: "Loved it", listened: 0, public: 1 },
      wishlist: null,
      reading: { listening: 0 },
    });
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
    expect(club.currentPick).toMatchObject({ title: "X", isReading: false });
    expect(club.stage).toBe("closed");

    await alice.post("/api/me/reading", { book_id: club.currentPick.book_id });
    expect((await alice.get(`/api/clubs/${clubId}`)).data.club.currentPick.isReading).toBe(true);
    expect((await bob.get(`/api/clubs/${clubId}`)).data.club.currentPick.isReading).toBe(false);
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
    expect((await alice.get(`/api/clubs/${clubId}`)).data.club.stage).toBe("runoff");
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
