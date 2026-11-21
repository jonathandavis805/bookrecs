// In-memory stand-in for a D1 database, backed by bun:sqlite and the real
// migrations, so core and API code can be tested without wrangler.
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dir, "../../migrations");

type Param = string | number | bigint | boolean | null | Uint8Array;

// Applies migrations in order, stopping before `until` (a filename) when given.
export function migrate(sqlite: Database, from?: string, until?: string): void {
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (from && file < from) continue;
    if (until && file >= until) break;
    sqlite.run(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
}

function asD1(sqlite: Database): D1Database {
  const runSync = (sql: string, params: Param[]) => {
    const r = sqlite.query(sql).run(...params);
    return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  };

  const statement = (sql: string, params: Param[] = []) => ({
    bind: (...next: Param[]) => statement(sql, next),
    all: async () => ({ results: sqlite.query(sql).all(...params), success: true, meta: {} }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
    run: async () => runSync(sql, params),
    runSync: () => runSync(sql, params),
  });

  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: ReturnType<typeof statement>[]) => sqlite.transaction(() => stmts.map((s) => s.runSync()))(),
  } as unknown as D1Database;
}

export function createTestDb(): D1Database {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON"); // D1 enforces foreign keys; bun:sqlite does not by default
  migrate(sqlite);
  return asD1(sqlite);
}
