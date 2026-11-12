#!/usr/bin/env bun
/**
 * Demo script: Shows the swipe-based recommendation algorithm in action
 * 
 * Run: bun run src/demo-swipe.ts
 * 
 * Simulates a user swiping through books, demonstrating how the algorithm
 * learns their preferences over time.
 */

import { RecommendationEngine, type Book } from './recommendations';
import { SEED_BOOKS } from './book-data';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function formatBook(book: Book, rank?: number): string {
  const prefix = rank ? `${colors.bold}${rank}.${colors.reset} ` : '   ';
  return `${prefix}${colors.bold}${book.title}${colors.reset} by ${book.author}\n` +
    `   ${colors.dim}Genre: ${book.genres.join(', ')} | Mood: ${book.mood.join(', ')}${colors.reset}\n` +
    `   ${colors.dim}Length: ${book.length} | Era: ${book.era} | Complexity: ${book.complexity}${colors.reset}`;
}

function simulateUser(book: Book, preferenceProfile: string): boolean {
  // Simulate a user who prefers: thought-provoking literary fiction, sci-fi with depth,
  // shorter reads, moderate complexity, and beautiful/lyrical writing
  const likes = [
    book.mood.includes('thought-provoking'),
    book.mood.includes('beautiful') || book.mood.includes('lyrical'),
    book.genres.includes('literary-fiction') || book.genres.includes('sci-fi'),
    book.length !== 'long' || book.complexity !== 'dense',
    book.themes.some(t => ['identity', 'consciousness', 'humanity', 'love'].includes(t))
  ];
  
  const likeCount = likes.filter(Boolean).length;
  // Probabilistic: the more criteria match, the more likely a swipe right
  return Math.random() < (likeCount / likes.length) * 0.9 + 0.1;
}

function printHeader(text: string) {
  console.log(`\n${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}  ${text}${colors.reset}`);
  console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}\n`);
}

function main() {
  printHeader('Swipe-Based Book Recommendation Demo');
  
  const engine = new RecommendationEngine(SEED_BOOKS);
  const seenBooks = new Set<string>();
  const totalSwipes = 30;
  
  console.log(`${colors.dim}Library: ${SEED_BOOKS.length} books seeded`);
  console.log(`Simulating ${totalSwipes} swipes to learn preferences...${colors.reset}\n`);
  
  // ── Phase 1: Initial recommendations (high exploration) ──
  printHeader('Phase 1: Initial Recommendations (High Exploration)');
  
  let initialRecs = engine.getRecommendations(5);
  console.log(`${colors.yellow}First batch of recommendations (random-ish):${colors.reset}\n`);
  initialRecs.forEach((book, i) => {
    console.log(formatBook(book, i + 1));
    console.log();
    seenBooks.add(book.id);
  });
  
  const stats1 = engine.getStats();
  console.log(`${colors.dim}Exploration rate: ${(stats1.explorationRate * 100).toFixed(1)}%${colors.reset}`);
  
  // ── Phase 2: Swipe through books and learn ──
  printHeader('Phase 2: Learning from Swipes');
  
  let likes = 0;
  let dislikes = 0;
  
  for (let i = 0; i < totalSwipes; i++) {
    // Get a batch of recommendations
    const recs = engine.getRecommendations(1, seenBooks);
    
    if (recs.length === 0) break;
    
    const book = recs[0];
    const liked = simulateUser(book, 'thoughtful-literary');
    
    engine.recordSwipe(book, liked);
    seenBooks.add(book.id);
    
    if (liked) {
      likes++;
      console.log(`${colors.green}→ SWIPE RIGHT${colors.reset} ✓ ${colors.bold}${book.title}${colors.reset} by ${book.author}`);
      console.log(`  ${colors.dim}(${book.genres.join(', ')})${colors.reset}`);
    } else {
      dislikes++;
      console.log(`${colors.red}→ SWIPE LEFT${colors.reset}  ✗ ${colors.bold}${book.title}${colors.reset} by ${book.author}`);
      console.log(`  ${colors.dim}(${book.genres.join(', ')})${colors.reset}`);
    }
  }
  
  const stats2 = engine.getStats();
  console.log(`\n${colors.dim}After ${totalSwipes} swipes: ${likes} likes, ${dislikes} dislikes`);
  console.log(`Exploration rate: ${(stats2.explorationRate * 100).toFixed(1)}%${colors.reset}`);
  
  // ── Phase 3: Refined recommendations ──
  printHeader('Phase 3: Refined Recommendations (Low Exploration)');
  
  const refinedRecs = engine.getRecommendations(10);
  console.log(`${colors.green}Top 10 recommendations after learning preferences:${colors.reset}\n`);
  refinedRecs.forEach((book, i) => {
    console.log(formatBook(book, i + 1));
    console.log();
  });
  
  // ── Phase 4: Show learned preferences ──
  printHeader('Phase 4: Learned Preferences');
  
  const prefs = engine.getPreferenceProfile();
  
  console.log(`${colors.bold}Top Genres:${colors.reset}`);
  const topGenres = Object.entries(prefs.genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  topGenres.forEach(([genre, weight]) => {
    const bar = '█'.repeat(Math.round(Math.abs(weight) * 20));
    const color = weight >= 0 ? colors.green : colors.red;
    console.log(`  ${genre.padEnd(20)} ${color}${bar} ${weight.toFixed(2)}${colors.reset}`);
  });
  
  console.log(`\n${colors.bold}Top Moods:${colors.reset}`);
  const topMoods = Object.entries(prefs.moodWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  topMoods.forEach(([mood, weight]) => {
    const bar = '█'.repeat(Math.round(Math.abs(weight) * 20));
    const color = weight >= 0 ? colors.green : colors.red;
    console.log(`  ${mood.padEnd(20)} ${color}${bar} ${weight.toFixed(2)}${colors.reset}`);
  });
  
  console.log(`\n${colors.bold}Top Themes:${colors.reset}`);
  const topThemes = Object.entries(prefs.themeWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  topThemes.forEach(([theme, weight]) => {
    const bar = '█'.repeat(Math.round(Math.abs(weight) * 20));
    const color = weight >= 0 ? colors.green : colors.red;
    console.log(`  ${theme.padEnd(25)} ${color}${bar} ${weight.toFixed(2)}${colors.reset}`);
  });
  
  console.log(`\n${colors.bold}Length Preferences:${colors.reset}`);
  for (const [length, weight] of Object.entries(prefs.lengthWeights)) {
    const bar = '█'.repeat(Math.round(Math.abs(weight) * 20));
    const color = weight >= 0 ? colors.green : colors.red;
    console.log(`  ${length.padEnd(10)} ${color}${bar} ${weight.toFixed(2)}${colors.reset}`);
  }
  
  console.log(`\n${colors.bold}Complexity Preferences:${colors.reset}`);
  for (const [complexity, weight] of Object.entries(prefs.complexityWeights)) {
    const bar = '█'.repeat(Math.round(Math.abs(weight) * 20));
    const color = weight >= 0 ? colors.green : colors.red;
    console.log(`  ${complexity.padEnd(10)} ${color}${bar} ${weight.toFixed(2)}${colors.reset}`);
  }
  
  printHeader('How the Algorithm Works');
  console.log(`
${colors.bold}1. Feature Vectors${colors.reset}
   Each book is represented as a vector of features: genres, themes, mood,
   length, era, and complexity.

${colors.bold}2. Preference Learning${colors.reset}
   When you swipe RIGHT (like), the weights for that book's features increase.
   When you swipe LEFT (dislike), those weights decrease.

${colors.bold}3. Thompson Sampling (Exploration vs. Exploitation)${colors.reset}
   The algorithm adds random noise to scores based on an exploration rate.
   Early on: HIGH exploration → tries diverse recommendations
   Over time: LOW exploration → focuses on what it knows you like

${colors.bold}4. Cold Start → Refined${colors.reset}
   First swipes: wide variety, algorithm is learning
   After 10-15 swipes: recommendations converge to your taste
   After 30+ swipes: highly personalized picks

${colors.bold}5. Key Parameters${colors.reset}
   • Learning rate (0.1): How fast preferences update per swipe
   • Initial exploration (0.3): Starting randomness level
   • Decay curve: exploration = 0.3 * e^(-swipes/20)
`);
}

main();
