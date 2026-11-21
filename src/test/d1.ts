// In-memory stand-in for a D1 database, backed by bun:sqlite and the real
// migrations, so core and API code can be tested without wrangler.
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dir, "../../migrations");

type Param = string | number | bigint | boolean | null | Uint8Array;

export function createTestDb(): D1Database {
  const sqlite = new Database(":memory:");
  for (const file of readdirSync(MIGRATIONS).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }

  const statement = (sql: string, params: Param[] = []) => ({
    bind: (...next: Param[]) => statement(sql, next),
    all: async () => ({ results: sqlite.query(sql).all(...params), success: true, meta: {} }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
    run: async () => runSync(sql, params),
    runSync: () => runSync(sql, params),
  });

  const runSync = (sql: string, params: Param[]) => {
    const r = sqlite.query(sql).run(...params);
    return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  };

  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: ReturnType<typeof statement>[]) => sqlite.transaction(() => stmts.map((s) => s.runSync()))(),
  } as unknown as D1Database;
}
