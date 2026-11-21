#!/usr/bin/env bun
/**
 * Backfill subjects cache for discover candidates
 *
 * This script fetches OpenLibrary subjects for all books that don't have
 * cached subjects yet. Run this once to warm up the cache so the discover
 * endpoint is fast.
 *
 * Usage: bun run scripts/backfill-subjects.ts
 */

import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.BOOKRECS_DB ? resolve(process.env.BOOKRECS_DB) : resolve(REPO_ROOT, "data/bookrecs.sqlite");

const db = new Database(DB_PATH);
const BASE = "https://openlibrary.org";
const USER_AGENT = "bookrecs/1.0 (personal book tracking app)";

interface BookRow {
  id: number;
  ol_key: string;
}

async function fetchSubjects(olKey: string): Promise<string[]> {
  try {
    const url = `${BASE}${olKey}.json`;
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return [];

    const data = await response.json();
    return data.subjects || [];
  } catch (error) {
    console.error(`Failed to fetch ${olKey}:`, error);
    return [];
  }
}

async function backfill() {
  console.log("Finding books without cached subjects...");

  const books = db
    .query("SELECT id, ol_key FROM books WHERE subjects IS NULL AND ol_key NOT LIKE 'manual:%'")
    .all() as BookRow[];

  console.log(`Found ${books.length} books to process`);

  let updated = 0;
  let failed = 0;

  for (const book of books) {
    process.stdout.write(`\rProcessing ${updated + failed + 1}/${books.length}: ${book.ol_key.substring(0, 50)}...`);

    const subjects = await fetchSubjects(book.ol_key);

    if (subjects.length > 0) {
      db.query("UPDATE books SET subjects = ? WHERE id = ?").run(JSON.stringify(subjects), book.id);
      updated++;
    } else {
      // Store empty array so we don't retry
      db.query("UPDATE books SET subjects = ? WHERE id = ?").run("[]", book.id);
      failed++;
    }

    // Rate limiting: wait 100ms between requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`\n\nDone!`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Failed/Empty: ${failed}`);
  console.log(`  Total: ${books.length}`);
}

backfill().catch(console.error);
