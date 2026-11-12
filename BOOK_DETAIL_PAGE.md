# Book Detail Page Feature

## Overview
A dedicated page for each book that displays comprehensive information including synopsis, friend activity, and reviews.

## Features

### 1. Book Information
- Cover image
- Title
- Author(s)
- Publication year

### 2. Synopsis
- Full book synopsis/description fetched from Open Library
- Automatically backfilled for existing books (19 books updated)
- New books automatically get synopsis when added

### 3. Friend Activity
Shows which of your friends have interacted with this book:

#### Currently Reading
- Friends who are currently reading this book
- Displayed at the top with a "📖 Reading" badge

#### Reviews Carousel
- Interactive carousel showing reviews from friends who have read the book
- Navigation arrows to browse through reviews
- Shows reviewer's username and ranking
- Counter showing current position (e.g., "2 of 5 reviews")

#### Friends Who Read This
- List of friends who have read the book
- Shows their ranking (e.g., #1, #2, etc.)
- Only shows public reads

#### Friends Who Want to Read This
- List of friends who have this book on their wishlist
- Shows "Owned" badge if they've marked it as owned
- Shows "♡ Wishlist" badge otherwise
- Only shows public wishlist items

### 4. Navigation
- Click any book title (in Currently Reading, Read, or Wishlist lists) to view its detail page
- "← Back" button to return to previous page
- Direct URL: `#/book/{bookId}`

## Technical Details

### Backend
- **Database**: Added `synopsis` column to `books` table
- **API Endpoints**:
  - `GET /api/books/:id` - Returns book details with friend activity
  - `POST /api/books/backfill-synopses` - Fetches synopses for existing books from Open Library
- **Open Library Integration**:
  - Extracts description from work JSON
  - Handles both string and object formats for description
  - Caches synopsis in database for performance

### Frontend
- **Component**: `BookDetail.tsx`
- **Routing**: Added `#/book/:id` route
- **Styling**: Custom CSS for book detail page layout
- **Carousel**: Simple index-based review carousel with prev/next buttons

### Data Structure
```typescript
interface BookDetail extends Book {
  friends: FriendActivity[];
}

interface FriendActivity {
  username: string;
  review: string | null;
  rank: number | null;
  owned: number;
  status: "read" | "wishlist" | "reading";
}
```

## Usage

### Viewing Book Details
1. Navigate to "My Books" page
2. Click on any book title (in Currently Reading, Read, or Wishlist sections)
3. The book detail page will open showing:
   - Book cover and metadata
   - Synopsis (if available)
   - Friend activity (if any friends have interacted with the book)

### Backfill Synopses
To add synopses to existing books:
```bash
cd /Users/jonathandavis/repos/bookrecs
/Users/jonathandavis/.bun/bin/bun run scripts/backfill-synopses.ts
```

This script:
- Finds all books without synopses
- Fetches synopsis from Open Library for each book
- Updates the database
- Shows progress and results

### Adding New Books
When adding a new book (via search or manual entry):
1. If added via Open Library search, synopsis is automatically fetched
2. If added manually, synopsis will be null (can be backfilled later)

## Privacy
- Only shows friend activity for friends who have made their reads/wishlist public
- Your own activity is always visible on your own book detail page
- Reviews are only shown if the friend has made them public

## Live Demo
Visit: https://series-ultimate-suggestions-conclusion.trycloudflare.com

Try clicking on any book title to see the detail page in action!

## Future Enhancements
- Add ability to edit/supplement synopsis
- Add more detailed friend activity (e.g., when they added it)
- Add book recommendations based on friend activity
- Add ability to see all reviews across all friends (not just per-book)
