import { useEffect, useRef, useState } from "react";
import { RecommendationEngine, type Book } from "../recommendations";
import { SEED_BOOKS } from "../book-data";
import { api } from "../api";
import type { Book as ApiBook } from "../api";

const PREFS_KEY = "bookrecs:swipe-prefs";
const SEEN_KEY = "bookrecs:swipe-seen";
const PRETRAINED_KEY = "bookrecs:swipe-pretrained-books";

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePrefs(prefs: any) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function loadSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSeen(seen: string[]) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

function loadPretrained(): string[] {
  try {
    const raw = localStorage.getItem(PRETRAINED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePretrained(books: string[]) {
  localStorage.setItem(PRETRAINED_KEY, JSON.stringify(books));
}

/**
 * Normalize a title for comparison: lowercase, strip leading articles, trim punctuation
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/['"''""\-–—:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract last name from author string
 */
function lastName(author: string | null): string {
  if (!author) return "";
  const parts = author.trim().split(/\s+/);
  return (parts[parts.length - 1] || "").toLowerCase();
}

/**
 * Check if two books match by title + author
 */
function booksMatch(a: { title: string; author?: string | null }, b: { title: string; author?: string | null }): boolean {
  const titleA = normalizeTitle(a.title);
  const titleB = normalizeTitle(b.title);

  // Exact title match (after normalization)
  if (titleA === titleB) {
    if (a.author && b.author && lastName(a.author) === lastName(b.author)) {
      return true;
    }
    if (!a.author || !b.author) return true;
  }

  // One title contains the other (handles subtitle differences)
  if (titleA.includes(titleB) || titleB.includes(titleA)) {
    if (a.author && b.author && lastName(a.author) === lastName(b.author)) {
      return true;
    }
  }

  return false;
}

/**
 * Given a user's ranked books, find matches in the candidate pool
 * and return them sorted by rank with a weight based on position.
 * 
 * Weight scheme:
 * - Rank 1-3: weight 3 (strong signal — these are their favorites)
 * - Rank 4-10: weight 2 (moderate signal)
 * - Rank 11+: weight 1 (weak positive signal — they added it, so they like it)
 */
function matchUserBooks(
  userBooks: ApiBook[],
  candidatePool: Book[]
): Array<{ seedBook: Book; rank: number; weight: number }> {
  const sorted = [...userBooks]
    .filter(b => b.rank > 0)
    .sort((a, b) => a.rank - b.rank);

  const matches: Array<{ seedBook: Book; rank: number; weight: number }> = [];

  for (const userBook of sorted) {
    const candidateBook = candidatePool.find(c => booksMatch(userBook, c));
    if (!candidateBook) continue;

    // Avoid duplicate matches
    if (matches.some(m => m.seedBook.id === candidateBook.id)) continue;

    const rank = userBook.rank;
    const weight = rank <= 3 ? 3 : rank <= 10 ? 2 : 1;

    matches.push({ seedBook: candidateBook, rank, weight });
  }

  return matches;
}

export default function Discover() {
  const engineRef = useRef<RecommendationEngine | null>(null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set(loadSeen()));
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [stats, setStats] = useState({ totalSwipes: 0, likes: 0, dislikes: 0, explorationRate: 0.3 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isEntering, setIsEntering] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [libraryMatches, setLibraryMatches] = useState<Array<{ seedBook: Book; rank: number; weight: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [engineReady, setEngineReady] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  // Initialize engine and fetch dynamic candidates
  useEffect(() => {
    const saved = loadPrefs();
    const pretrainedIds = loadPretrained();

    // Fetch dynamic candidates from the app's book database
    Promise.all([
      api<{ books: Book[] }>("/api/discover/candidates").catch(() => ({ books: [] })),
      api<{ books: ApiBook[] }>("/api/me/books").catch(() => ({ books: [] })),
    ]).then(([{ books: candidates }, { books: userBooks }]) => {
      // Use dynamic candidates if available, fall back to seed catalog
      const bookPool: Book[] = (candidates && candidates.length > 0) ? candidates : SEED_BOOKS;

      // Initialize engine with the book pool
      const engine = new RecommendationEngine(bookPool);
      engineRef.current = engine;

      if (saved) {
        engine.loadPreferences(saved);
      }

      // Pre-train from user's ranked books
      if (userBooks && userBooks.length > 0) {
        // Match user's ranked books against the candidate pool
        let matches = matchUserBooks(userBooks, bookPool);

        // If no matches in the dynamic pool, try seed catalog as fallback
        if (matches.length === 0 && bookPool !== SEED_BOOKS) {
          matches = matchUserBooks(userBooks, SEED_BOOKS);
        }

        setLibraryMatches(matches);

        if (!saved) {
          // Cold start: pre-train from ranked books
          for (const { seedBook, weight } of matches) {
            engine.recordSwipe(seedBook, true, weight);
          }
          savePretrained(matches.map(m => String(m.seedBook.id)));
          updateFromEngine(engine);
        } else {
          // Check for new books added since last pre-training
          const newMatches = matches.filter(m => !pretrainedIds.includes(String(m.seedBook.id)));
          if (newMatches.length > 0) {
            for (const { seedBook, weight } of newMatches) {
              engine.recordSwipe(seedBook, true, weight);
            }
            savePretrained(matches.map(m => String(m.seedBook.id)));
            updateFromEngine(engine);
          }
        }
      }

      updateFromEngine(engine);
      setLoading(false);
      setEngineReady(true);
    }).catch(() => {
      setLoading(false);
      setEngineReady(true);
    });
  }, []);

  // Get next book when seen changes or engine becomes ready
  useEffect(() => {
    if (!engineRef.current || !engineReady) return;
    const recs = engineRef.current.getRecommendations(1, seen);
    setCurrentBook(recs[0] || null);
  }, [seen, engineReady]);

  function updateFromEngine(engine: RecommendationEngine) {
    const s = engine.getStats();
    setStats(s);
    savePrefs(engine.getPreferenceProfile());
  }

  function handleSwipe(liked: boolean) {
    if (!currentBook || !engineRef.current || isExiting || isEntering) return;

    const book = currentBook;

    // Start exit animation
    setIsExiting(true);
    setDragOffset({ x: liked ? 400 : -400, y: 0 });

    // Wait for exit animation to complete
    setTimeout(() => {
      engineRef.current!.recordSwipe(book, liked);
      updateFromEngine(engineRef.current!);

      const newSeen = new Set(seen);
      newSeen.add(book.id);
      setSeen(newSeen);
      saveSeen(Array.from(newSeen));

      // Reset position and prepare for enter animation
      setDragOffset({ x: 0, y: 0 });
      setIsExiting(false);
      setIsEntering(true);

      // Fade in the new card
      setTimeout(() => {
        setIsEntering(false);
      }, 50);
    }, 300);
  }

  function handleDragStart(e: React.MouseEvent | React.TouchEvent) {
    if (isExiting || isEntering || !currentBook) return;
    setIsDragging(true);
    const point = "touches" in e ? e.touches[0] : e;
    dragStart.current = { x: point.clientX, y: point.clientY };
  }

  function handleDragMove(e: React.MouseEvent | React.TouchEvent) {
    if (!isDragging || isExiting || isEntering) return;
    const point = "touches" in e ? e.touches[0] : e;
    setDragOffset({
      x: point.clientX - dragStart.current.x,
      y: (point.clientY - dragStart.current.y) * 0.3
    });
  }

  function handleDragEnd() {
    if (!isDragging || isExiting || isEntering) return;
    setIsDragging(false);

    const threshold = 100;
    if (dragOffset.x > threshold) {
      handleSwipe(true);
    } else if (dragOffset.x < -threshold) {
      handleSwipe(false);
    } else if (dragOffset.y > threshold) {
      handleSkip();
    } else {
      setDragOffset({ x: 0, y: 0 });
    }
  }

  function handleUndo() {
    // Reset seen to allow re-swiping recent books
    if (seen.size === 0) return;
    const newSeen = new Set(Array.from(seen).slice(0, -1));
    setSeen(newSeen);
    saveSeen(Array.from(newSeen));
  }

  function handleReset() {
    if (!confirm("Reset all swipe history? Your recommendations will start fresh.")) return;
    localStorage.removeItem(PREFS_KEY);
    localStorage.removeItem(SEEN_KEY);
    localStorage.removeItem(PRETRAINED_KEY);
    setSeen(new Set());
    setLibraryMatches([]);
    if (engineRef.current) {
      engineRef.current.loadPreferences({
        genreWeights: {},
        themeWeights: {},
        lengthWeights: { short: 0, medium: 0, long: 0 },
        eraWeights: { classic: 0, modern: 0, contemporary: 0 },
        complexityWeights: { light: 0, moderate: 0, dense: 0 },
        moodWeights: {},
        swipeHistory: [],
        explorationRate: 0.3
      });
      updateFromEngine(engineRef.current);
    }
  }

  function handleSkip() {
    if (!currentBook || isExiting || isEntering) return;

    // Start exit animation
    setIsExiting(true);
    setDragOffset({ x: 0, y: 400 });

    // Wait for exit animation to complete
    setTimeout(() => {
      // Don't call recordSwipe - just mark as seen
      const newSeen = new Set(seen);
      newSeen.add(currentBook.id);
      setSeen(newSeen);
      saveSeen(Array.from(newSeen));

      // Reset position and prepare for enter animation
      setDragOffset({ x: 0, y: 0 });
      setIsExiting(false);
      setIsEntering(true);

      // Fade in the new card
      setTimeout(() => {
        setIsEntering(false);
      }, 50);
    }, 300);
  }

  const rotation = dragOffset.x * 0.08;
  const scale = isExiting ? 0.9 : 1;
  const likeOpacity = Math.min(1, Math.max(0, dragOffset.x / 100));
  const nopeOpacity = Math.min(1, Math.max(0, -dragOffset.x / 100));
  const skipOpacity = Math.min(1, Math.max(0, dragOffset.y / 100));

  // During drag: slight fade. During exit: full fade out. During enter: start invisible.
  const dragDistance = Math.abs(dragOffset.x);
  const cardOpacity = isExiting
    ? 0
    : isEntering
      ? 0
      : isDragging
        ? Math.max(0.3, 1 - dragDistance / 400)
        : 1;

  const hasLibrarySignal = libraryMatches.length > 0;

  return (
    <div className="discover-page">
      <div className="page-head">
        <h2>Discover</h2>
        <div className="discover-stats">
          {hasLibrarySignal && (
            <span className="discover-library-badge" title="Your book rankings are informing these recommendations">
              📚 {libraryMatches.length} {libraryMatches.length === 1 ? "book" : "books"} from your library
            </span>
          )}
          <span className="muted-text">
            {stats.totalSwipes} swipes · {stats.likes} likes · {stats.dislikes} dislikes
          </span>
          {stats.totalSwipes > 0 && (
            <span className="muted-text" style={{ marginLeft: 8 }}>
              · {Math.round((1 - stats.explorationRate) * 100)}% dialed in
            </span>
          )}
        </div>
      </div>

      {loading && !currentBook ? (
        <div className="empty">
          <p>Loading recommendations…</p>
        </div>
      ) : currentBook ? (
        <div className="swipe-container">
          <div
            ref={cardRef}
            className={`swipe-card ${isEntering ? "entering" : ""}`}
            style={{
              transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${rotation}deg) scale(${scale})`,
              opacity: cardOpacity,
              transition: isDragging
                ? "opacity 0.1s ease"
                : isEntering
                  ? "opacity 0.3s ease, transform 0.3s ease"
                  : "transform 0.3s ease, opacity 0.3s ease",
            }}
            onMouseDown={handleDragStart}
            onMouseMove={handleDragMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
            onTouchStart={handleDragStart}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
          >
            <div className="swipe-card-content">
              <div className="swipe-card-header">
                <span className="swipe-genre-tag">{currentBook.genres[0]}</span>
              </div>

              <h3 className="swipe-title">{currentBook.title}</h3>
              <p className="swipe-author">{currentBook.author}</p>

              <div className="swipe-tags">
                {currentBook.mood.map((m) => (
                  <span key={m} className="swipe-tag mood">
                    {m}
                  </span>
                ))}
              </div>

              <div className="swipe-details">
                <div className="swipe-detail">
                  <span className="swipe-detail-label">Length</span>
                  <span className="swipe-detail-value">{currentBook.length}</span>
                </div>
                <div className="swipe-detail">
                  <span className="swipe-detail-label">Era</span>
                  <span className="swipe-detail-value">{currentBook.era}</span>
                </div>
                <div className="swipe-detail">
                  <span className="swipe-detail-label">Complexity</span>
                  <span className="swipe-detail-value">{currentBook.complexity}</span>
                </div>
              </div>

              <div className="swipe-themes">
                {currentBook.themes.map((t) => (
                  <span key={t} className="swipe-tag theme">
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div className="swipe-overlay like" style={{ opacity: likeOpacity }}>
              <span>LIKE</span>
            </div>
            <div className="swipe-overlay nope" style={{ opacity: nopeOpacity }}>
              <span>NOPE</span>
            </div>
          </div>

          <div className="swipe-actions">
            <button className="swipe-btn undo-btn" onClick={handleUndo} disabled={seen.size === 0}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
            </button>
            <button className="swipe-btn skip-btn" onClick={handleSkip}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>

          <p className="swipe-hint">Swipe or drag the card · Use buttons below</p>
        </div>
      ) : (
        <div className="empty">
          <p>You've seen all the books!</p>
          <p className="muted-text" style={{ marginTop: 8 }}>
            {stats.totalSwipes} swipes total · {stats.likes} likes · {stats.dislikes} dislikes
          </p>
          <button className="btn-sm" onClick={handleReset} style={{ marginTop: 16 }}>
            Start Over
          </button>
        </div>
      )}

      <div className="discover-footer">
        <button className="link" onClick={() => setShowPrefs(!showPrefs)}>
          {showPrefs ? "Hide" : "Show"} Your Taste Profile
        </button>
        <button className="link" onClick={handleReset} style={{ marginLeft: 12 }}>
          Reset
        </button>
      </div>

      {showPrefs && (
        <TasteProfile engine={engineRef.current} libraryMatches={libraryMatches} />
      )}
    </div>
  );
}

function TasteProfile({
  engine,
  libraryMatches,
}: {
  engine: RecommendationEngine | null;
  libraryMatches: Array<{ seedBook: Book; rank: number; weight: number }>;
}) {
  if (!engine) return null;

  const prefs = engine.getPreferenceProfile();

  const topGenres = Object.entries(prefs.genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topMoods = Object.entries(prefs.moodWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topThemes = Object.entries(prefs.themeWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const maxWeight = Math.max(
    ...topGenres.map(([, w]) => Math.abs(w)),
    ...topMoods.map(([, w]) => Math.abs(w)),
    0.1
  );

  return (
    <div className="taste-profile">
      <h3>Your Taste Profile</h3>

      {libraryMatches.length > 0 && (
        <div className="taste-section">
          <h4>Informed by your library</h4>
          <div className="taste-library-list">
            {libraryMatches
              .sort((a, b) => a.rank - b.rank)
              .map(({ seedBook, rank, weight }) => (
                <div key={seedBook.id} className="taste-library-item">
                  <span className="taste-library-rank">#{rank}</span>
                  <span className="taste-library-title">{seedBook.title}</span>
                  <span className="taste-library-weight">
                    {"●".repeat(weight)}
                    {"○".repeat(3 - weight)}
                  </span>
                </div>
              ))}
          </div>
          <p className="taste-library-note muted-text">
            Books higher on your list carry more weight in shaping recommendations.
          </p>
        </div>
      )}

      {topGenres.length > 0 && (
        <div className="taste-section">
          <h4>Genres</h4>
          {topGenres.map(([name, weight]) => (
            <div key={name} className="taste-row">
              <span className="taste-label">{name.replace(/-/g, " ")}</span>
              <div className="taste-bar-container">
                <div
                  className={`taste-bar ${weight >= 0 ? "positive" : "negative"}`}
                  style={{ width: `${(Math.abs(weight) / maxWeight) * 100}%` }}
                />
              </div>
              <span className="taste-value">{weight.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {topMoods.length > 0 && (
        <div className="taste-section">
          <h4>Moods</h4>
          {topMoods.map(([name, weight]) => (
            <div key={name} className="taste-row">
              <span className="taste-label">{name.replace(/-/g, " ")}</span>
              <div className="taste-bar-container">
                <div
                  className={`taste-bar ${weight >= 0 ? "positive" : "negative"}`}
                  style={{ width: `${(Math.abs(weight) / maxWeight) * 100}%` }}
                />
              </div>
              <span className="taste-value">{weight.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {topThemes.length > 0 && (
        <div className="taste-section">
          <h4>Themes</h4>
          {topThemes.map(([name, weight]) => (
            <div key={name} className="taste-row">
              <span className="taste-label">{name.replace(/-/g, " ")}</span>
              <div className="taste-bar-container">
                <div
                  className={`taste-bar ${weight >= 0 ? "positive" : "negative"}`}
                  style={{ width: `${(Math.abs(weight) / maxWeight) * 100}%` }}
                />
              </div>
              <span className="taste-value">{weight.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {topGenres.length === 0 && topMoods.length === 0 && libraryMatches.length === 0 && (
        <p className="muted-text">Swipe some books to build your taste profile!</p>
      )}
    </div>
  );
}
