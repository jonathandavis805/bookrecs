# Dynamic Book Catalog for Discover

## Overview

The Discover feature now uses a **hybrid book catalog** that combines:
1. **Dynamic candidates** from your app's database (books users have added via OpenLibrary)
2. **Seed catalog** as fallback (40 hand-curated books with features)

This replaces the old static `SEED_BOOKS` array with a system that grows automatically as users add books to the app.

## How It Works

### Backend: `/api/discover/candidates`

**New endpoint** in `src/api.ts` and `src/core.ts`:

```typescript
GET /api/discover/candidates
```

Returns up to 100 books the user hasn't read yet, enriched with features:

```json
{
  "books": [
    {
      "id": "123",
      "ol_key": "/works/OL12345W",
      "title": "Project Hail Mary",
      "author": "Andy Weir",
      "genres": ["sci-fi", "adventure"],
      "themes": ["survival", "friendship", "science"],
      "mood": ["exciting", "thought-provoking", "humorous"],
      "length": "medium",
      "era": "contemporary",
      "complexity": "moderate"
    }
  ]
}
```

### Feature Extraction

For each book, the system:

1. **Fetches OpenLibrary subjects** from the work's JSON endpoint
   - Example: `/works/OL12345W.json` returns `subjects: ["Science fiction", "Space flight", "Survival"]`

2. **Maps subjects to features** using curated dictionaries:
   - **Genres** (26 mappings): "science fiction" → "sci-fi", "historical fiction" → "historical-fiction"
   - **Themes** (35 mappings): "coming of age" → "coming-of-age", "artificial intelligence" → "technology"
   - **Moods** (38 mappings): "uplifting" → "uplifting", "philosophical" → "thought-provoking"

3. **Derives meta-features**:
   - **Length**: Estimated from synopsis length (<200 chars = short, >500 = long)
   - **Era**: From publication year (<1950 = classic, <2000 = modern, else contemporary)
   - **Complexity**: From synopsis length (<150 chars = light, >600 = dense)

### Fallback Strategy

The system uses a **graceful fallback** chain:

1. **Primary**: Dynamic candidates from `/api/discover/candidates`
   - Books users have added to the app
   - Enriched with OpenLibrary data
   - Grows automatically as users add more books

2. **Secondary**: Seed catalog (`web/src/book-data.ts`)
   - 40 hand-curated books
   - Always available as fallback
   - Used when:
     - API returns empty results
     - Network errors
     - User hasn't added any books yet
     - Pre-training matches (if dynamic pool has no overlap with user's ranked books)

### Pre-Training with Ranked Books

The recommendation engine still learns from your ranked books:

1. **Fetches user's ranked books** from `/api/me/books`
2. **Matches against dynamic pool** (or seed catalog as fallback)
3. **Weights by rank**:
   - Rank 1-3: weight 3 (strong signal — favorites)
   - Rank 4-10: weight 2 (moderate signal)
   - Rank 11+: weight 1 (weak signal)
4. **Pre-trains the engine** so recommendations start relevant

### Matching Logic

Books are matched by **normalized title + author**:
- Lowercased
- Stripped of leading articles ("the", "a", "an")
- Punctuation removed
- Author last name comparison

This handles variations like:
- "The Great Gatsby" ↔ "Great Gatsby"
- "Dune" by "Frank Herbert" ↔ "Dune" by "Frank Herbert"

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ User loads Discover page                                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ├─→ GET /api/discover/candidates
                 │   └─→ Returns unread books from DB
                 │   └─→ Enriched with OL subjects → features
                 │
                 └─→ GET /api/me/books
                     └─→ Returns user's ranked books
                 
                 ↓
┌─────────────────────────────────────────────────────────┐
│ If candidates > 0: use dynamic pool                     │
│ Else: use SEED_BOOKS (40 curated books)                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ├─→ Match user's ranked books against pool
                 │   └─→ If no matches, try SEED_BOOKS
                 │
                 └─→ Pre-train engine with weighted swipes
                 
                 ↓
┌─────────────────────────────────────────────────────────┐
│ Recommendation engine initialized                       │
│ Ready for interactive swiping                           │
└─────────────────────────────────────────────────────────┘
```

## Performance Considerations

### API Endpoint

- Fetches up to 200 books from DB
- Filters to unread books
- Calls OpenLibrary API for each book (can be slow)
- **Potential optimization**: Cache OL subjects in the database

### Caching Strategy

Currently, OL subjects are fetched on every API call. To improve performance:

1. **Add `subjects` column** to `books` table
2. **Backfill subjects** similar to how synopses are backfilled
3. **Update `getDiscoverCandidates`** to read from cache instead of calling OL

Example migration:
```sql
ALTER TABLE books ADD COLUMN subjects TEXT; -- JSON array
```

### Rate Limiting

OpenLibrary has rate limits. Current system:
- Fetches subjects for up to 100 books per request
- No caching = 100 API calls per user load

**Recommended**: Cache subjects in DB to avoid repeated calls.

## Future Enhancements

### 1. Subject Caching
- Store OL subjects in `books` table
- Background job to populate missing subjects
- Eliminates repeated OL API calls

### 2. Smarter Feature Extraction
- Use OpenLibrary's `subject_places`, `subject_times`, `subject_people`
- Better mood detection from synopsis text analysis
- Genre classification from multiple signals (subjects + synopsis)

### 3. Dynamic Length/Complexity
- Use actual page counts from OpenLibrary editions API
- Better complexity estimation from synopsis readability (Flesch-Kincaid)

### 4. Collaborative Filtering
- Aggregate features from users who liked similar books
- "Users who liked X also liked Y" recommendations

### 5. Personalized Catalog
- Prioritize books from genres the user has shown interest in
- Weight recent additions higher
- Seasonal/trending books

## Files Modified

### Backend
- `src/api.ts` — Added `/api/discover/candidates` endpoint
- `src/core.ts` — Added `getDiscoverCandidates()`, feature extraction logic

### Frontend
- `web/src/components/Discover.tsx` — Fetches dynamic candidates, falls back to seed catalog
- `web/src/recommendations.ts` — Updated `recordSwipe()` to accept optional weight parameter
- `web/src/book-data.ts` — Kept as fallback (40 seed books)

## Testing

To test the dynamic catalog:

1. Add books to your library via the "Add Book" tab
2. Navigate to "Discover" tab
3. Check browser console for `/api/discover/candidates` response
4. Verify books appear that you haven't read
5. Swipe through and verify recommendations adapt

## Migration Path

If you want to enable subject caching:

1. Add migration to `src/db.ts`:
```typescript
const subjectCols = db.query("PRAGMA table_info(books)").all() as { name: string }[];
if (!subjectCols.some(c => c.name === "subjects")) {
  db.exec("ALTER TABLE books ADD COLUMN subjects TEXT");
}
```

2. Update `core.ts` to cache subjects after fetching
3. Add background job to backfill subjects for existing books
4. Update `getDiscoverCandidates()` to read from cache
