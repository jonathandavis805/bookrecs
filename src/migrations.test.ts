import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrate } from "./test/d1";

test("0011 maps the old club flags onto a single stage", () => {
  const sqlite = new Database(":memory:");
  migrate(sqlite, undefined, "0011_club_stage.sql");
  sqlite.run("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'a', 'a@test.dev', 'x')");
  const flags = [
    ["nominating", 0, 1, 0],
    ["voting", 1, 0, 0],
    ["runoff", 1, 0, 1],
    ["closed", 0, 0, 0],
  ] as const;
  for (const [name, voting, nominations, runoff] of flags) {
    sqlite.run("INSERT INTO clubs (name, creator_id, voting_open, nominations_open, runoff) VALUES (?, 1, ?, ?, ?)", [
      name,
      voting,
      nominations,
      runoff,
    ]);
  }

  migrate(sqlite, "0011_club_stage.sql");

  const rows = sqlite.query("SELECT name, stage FROM clubs ORDER BY id").all() as { name: string; stage: string }[];
  expect(rows.map((r) => r.stage)).toEqual(rows.map((r) => r.name));
  const columns = (sqlite.query("PRAGMA table_info(clubs)").all() as { name: string }[]).map((c) => c.name);
  expect(columns).not.toContain("voting_open");
  expect(columns).not.toContain("runoff");
});

test("0016_shared_categories keeps existing category assignments", () => {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  migrate(sqlite, undefined, "0016_shared_categories.sql");
  sqlite.run("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'a', 'a@test.dev', 'x')");
  sqlite.run("INSERT INTO books (id, ol_key, title) VALUES (7, 'k', 'Dune')");
  sqlite.run("INSERT INTO reads (user_id, book_id, rank) VALUES (1, 7, 1)");
  sqlite.run("INSERT INTO categories (id, user_id, name) VALUES (3, 1, 'Sci-fi')");
  sqlite.run("INSERT INTO category_books (category_id, user_id, book_id) VALUES (3, 1, 7)");

  migrate(sqlite, "0016_shared_categories.sql");

  expect(sqlite.query("SELECT * FROM category_books").all()).toEqual([{ category_id: 3, user_id: 1, book_id: 7 }]);
});

test("0017 keeps open nominations, and their votes as first choices", () => {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  migrate(sqlite, undefined, "0017_ranked_voting.sql");
  sqlite.run("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'a', 'a@test.dev', 'x')");
  sqlite.run("INSERT INTO books (id, ol_key, title) VALUES (7, 'k', 'Dune')");
  sqlite.run("INSERT INTO clubs (id, name, creator_id) VALUES (2, 'Club', 1)");
  sqlite.run("INSERT INTO club_nominations (id, club_id, user_id, book_id) VALUES (3, 2, 1, 7)");
  sqlite.run("INSERT INTO club_votes (nomination_id, user_id) VALUES (3, 1)");

  migrate(sqlite, "0017_ranked_voting.sql");

  expect(sqlite.query("SELECT id, pick_id, eliminated FROM club_nominations").all()).toEqual([
    { id: 3, pick_id: null, eliminated: 0 },
  ]);
  expect(sqlite.query("SELECT nomination_id, user_id, rank FROM club_votes").all()).toEqual([
    { nomination_id: 3, user_id: 1, rank: 1 },
  ]);
  sqlite.run("DELETE FROM club_nominations");
  expect(sqlite.query("SELECT * FROM club_votes").all()).toEqual([]);
});
