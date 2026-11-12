import { Database } from 'bun:sqlite';
import { fetchSynopsis } from '../src/ol.ts';

const db = new Database('data/bookrecs.sqlite');

// Get all books without synopsis that have an ol_key (not manual books)
const books = db.query(
  "SELECT id, ol_key FROM books WHERE synopsis IS NULL AND ol_key NOT LIKE 'manual:%'"
).all() as { id: number; ol_key: string }[];

console.log(`Found ${books.length} books without synopsis`);

let updated = 0;
let failed = 0;

for (const book of books) {
  try {
    console.log(`Fetching synopsis for book ${book.id}: ${book.ol_key}`);
    const synopsis = await fetchSynopsis(book.ol_key);
    
    if (synopsis) {
      db.query("UPDATE books SET synopsis = ? WHERE id = ?").run(synopsis, book.id);
      console.log(`✓ Updated book ${book.id}`);
      updated++;
    } else {
      console.log(`- No synopsis available for book ${book.id}`);
    }
    
    // Small delay to be nice to Open Library
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (e) {
    console.error(`✗ Failed to fetch synopsis for book ${book.id}:`, e);
    failed++;
  }
}

console.log(`\nDone! Updated: ${updated}, Failed: ${failed}`);
