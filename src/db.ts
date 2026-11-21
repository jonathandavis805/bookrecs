export type { D1Database } from "@cloudflare/workers-types";

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

// Helper to run a D1 query and return a single row
export async function queryOne<T>(db: D1Database, sql: string, ...params: any[]): Promise<T | null> {
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return results[0] ?? null;
}

// Helper to run a D1 query and return all rows
export async function queryAll<T>(db: D1Database, sql: string, ...params: any[]): Promise<T[]> {
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return results;
}

// Helper to run a D1 write (INSERT/UPDATE/DELETE)
export async function execute(db: D1Database, sql: string, ...params: any[]): Promise<D1Result> {
  return await db
    .prepare(sql)
    .bind(...params)
    .run();
}
