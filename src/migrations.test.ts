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
