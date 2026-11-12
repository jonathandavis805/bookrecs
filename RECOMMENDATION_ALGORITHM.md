# Swipe-Based Book Recommendation Algorithm

## Overview

A collaborative filtering-style recommendation engine that learns your reading preferences through swipe left/right feedback. The algorithm gets smarter with each swipe, balancing exploration (discovering new preferences) with exploitation (recommending what it knows you'll like).

## How It Works

### 1. Feature Vector Representation

Each book is represented as a multi-dimensional feature vector:

```typescript
{
  genres: ['sci-fi', 'literary-fiction'],
  themes: ['identity', 'consciousness', 'love'],
  length: 'medium',  // short | medium | long
  era: 'contemporary',  // classic | modern | contemporary
  complexity: 'moderate',  // light | moderate | dense
  mood: ['thought-provoking', 'beautiful', 'lyrical']
}
```

### 2. Preference Learning

Your preferences are stored as weighted vectors for each feature category:

- **genreWeights**: How much you like each genre
- **themeWeights**: How much you like each theme
- **lengthWeights**: Preference for book lengths
- **eraWeights**: Preference for different time periods
- **complexityWeights**: How dense/light you like your reading
- **moodWeights**: Emotional tone preferences

When you swipe:
- **RIGHT (like)**: Increases weights for that book's features (+0.1)
- **LEFT (dislike)**: Decreases weights for that book's features (-0.1)

### 3. Thompson Sampling (Exploration vs. Exploitation)

The algorithm uses **Thompson Sampling** to balance trying new things vs. recommending known preferences:

```typescript
finalScore = baseScore + (explorationRate * gaussianNoise)
```

- **Early on** (0-10 swipes): High exploration rate (30%) → diverse recommendations
- **Mid-way** (10-20 swipes): Moderate exploration → starting to converge
- **Later** (20+ swipes): Low exploration (5-10%) → highly personalized

The exploration rate decays exponentially: `exploration = 0.3 * e^(-swipes/20)`

### 4. Scoring Algorithm

For each candidate book:

1. Convert book features to a normalized vector (0 or 1 for each feature)
2. Calculate dot product with user preference weights
3. Add exploration noise (Gaussian random × exploration rate)
4. Sort by final score and return top recommendations

### 5. Learning Rate & Convergence

- **Learning rate**: 0.1 per swipe (adjustable)
- **Convergence**: After ~20-30 swipes, preferences stabilize
- **Cold start**: First 5-10 swipes are mostly exploration

## Demo

Run the interactive demo:

```bash
bun run demo:swipe
```

Or with npx:

```bash
npx tsx src/demo-swipe.ts
```

The demo simulates a user swiping through 40 books and shows:
- Initial recommendations (high exploration)
- Swipe feedback learning
- Refined recommendations (low exploration)
- Learned preference visualization

## Files

- `src/recommendations.ts` - Core algorithm implementation
- `src/book-data.ts` - 40 seed books with features
- `src/demo-swipe.ts` - Interactive demo script

## Usage in Your App

### Initialize

```typescript
import { RecommendationEngine } from './recommendations';
import { SEED_BOOKS } from './book-data';

const engine = new RecommendationEngine(SEED_BOOKS);
```

### Get Recommendations

```typescript
// Get top 10 recommendations
const recs = engine.getRecommendations(10);

// Exclude already-seen books
const seen = new Set(['b001', 'b002']);
const newRecs = engine.getRecommendations(10, seen);
```

### Record Swipes

```typescript
import type { Book } from './recommendations';

const book: Book = recs[0];
const liked = true; // or false

engine.recordSwipe(book, liked);
```

### Persist Preferences

```typescript
// Get current preferences (save to database)
const prefs = engine.getPreferenceProfile();

// Load saved preferences (from database)
engine.loadPreferences(savedPrefs);
```

### Get Stats

```typescript
const stats = engine.getStats();
// {
//   totalBooks: 40,
//   totalSwipes: 15,
//   likes: 10,
//   dislikes: 5,
//   explorationRate: 0.14
// }
```

## Algorithm Tuning

You can adjust these parameters in `src/recommendations.ts`:

| Parameter | Default | Effect |
|-----------|---------|--------|
| `learningRate` | 0.1 | Higher = faster learning, lower = more stable |
| `initialExploration` | 0.3 | Higher = more diverse early recommendations |
| `decayRate` | 20 | Higher = slower decay, more exploration longer |
| `minExploration` | 0.05 | Floor for exploration rate (never go below) |

## Future Enhancements

### Possible Improvements

1. **Collaborative Filtering**: Use patterns from similar users
2. **Content-Based Boosting**: Integrate with OpenLibrary API for real book data
3. **Context-Aware**: Time of day, recent reads, seasonal preferences
4. **Negative Preference Learning**: Track what you *don't* want to see
5. **Confidence Scoring**: Show how confident the algorithm is in each rec
6. **A/B Testing**: Test different exploration strategies
7. **Social Features**: Share preferences with friends, see their recs

### Integration Ideas

- **Web UI**: React component with swipe gestures (react-swipeable)
- **API Endpoints**: POST `/swipe`, GET `/recommendations`
- **Database Persistence**: Store preferences in SQLite/PostgreSQL
- **Real Book Data**: Fetch from OpenLibrary, Google Books API

## Why This Approach?

**Pros:**
- ✅ Simple to understand and implement
- ✅ Works with small datasets (cold start friendly)
- ✅ Adapts quickly to user preferences
- ✅ Balances exploration and exploitation
- ✅ No complex ML infrastructure needed

**Cons:**
- ❌ Doesn't leverage social/collaborative data (yet)
- ❌ Feature engineering is manual (could be automated)
- ❌ No deep learning (but not needed for this scale)

**Alternatives Considered:**
- **Matrix Factorization**: Overkill for <1000 books
- **Deep Learning**: Too complex, not enough data
- **Content-Based Only**: Doesn't learn from swipes
- **Collaborative Only**: Needs many users to work well

This hybrid approach gives the best of both worlds: content-based features + collaborative learning from swipes.

## Testing

The demo shows the algorithm converging correctly:

```
Phase 1: High exploration (30%)
  → Diverse, random-ish recommendations

Phase 2: Learning from 30 swipes
  → 23 likes, 7 dislikes
  → Exploration drops to 6.7%

Phase 3: Refined recommendations
  → Top picks match learned preferences
  → Literary fiction, sci-fi, thought-provoking moods
```

## License

Part of the bookrecs project.
