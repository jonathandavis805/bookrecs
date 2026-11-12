/**
 * Swipe-Based Book Recommendation Algorithm
 * 
 * Uses a vector-based approach with Thompson Sampling for exploration/exploitation balance.
 * Books are represented as feature vectors, and user preferences are learned through swipes.
 */

export interface Book {
  id: string;
  title: string;
  author: string;
  genres: string[];
  themes: string[];
  length: 'short' | 'medium' | 'long'; // pages: <300, 300-500, >500
  era: 'classic' | 'modern' | 'contemporary'; // pre-1950, 1950-2000, post-2000
  complexity: 'light' | 'moderate' | 'dense'; // reading difficulty
  mood: string[]; // e.g., 'uplifting', 'dark', 'thought-provoking', 'adventurous'
}

export interface Swipe {
  bookId: string;
  liked: boolean;
  timestamp: number;
}

export interface UserPreference {
  // Weights for each feature dimension (higher = more preferred)
  genreWeights: Record<string, number>;
  themeWeights: Record<string, number>;
  lengthWeights: Record<'short' | 'medium' | 'long', number>;
  eraWeights: Record<'classic' | 'modern' | 'contemporary', number>;
  complexityWeights: Record<'light' | 'moderate' | 'dense', number>;
  moodWeights: Record<string, number>;
  
  // Track swipe history for Thompson Sampling
  swipeHistory: Swipe[];
  
  // Exploration parameter (starts high, decreases over time)
  explorationRate: number;
}

export class RecommendationEngine {
  private books: Book[];
  private userPreference: UserPreference;
  
  constructor(books: Book[]) {
    this.books = books;
    this.userPreference = this.initializePreferences();
  }
  
  private initializePreferences(): UserPreference {
    return {
      genreWeights: {},
      themeWeights: {},
      lengthWeights: { short: 0, medium: 0, long: 0 },
      eraWeights: { classic: 0, modern: 0, contemporary: 0 },
      complexityWeights: { light: 0, moderate: 0, dense: 0 },
      moodWeights: {},
      swipeHistory: [],
      explorationRate: 0.3 // Start with 30% exploration
    };
  }
  
  /**
   * Convert a book to a feature vector for similarity calculations
   */
  private bookToFeatures(book: Book): Record<string, number> {
    const features: Record<string, number> = {};
    
    // Normalize features to 0-1 scale
    book.genres.forEach(g => features[`genre:${g}`] = 1);
    book.themes.forEach(t => features[`theme:${t}`] = 1);
    features[`length:${book.length}`] = 1;
    features[`era:${book.era}`] = 1;
    features[`complexity:${book.complexity}`] = 1;
    book.mood.forEach(m => features[`mood:${m}`] = 1);
    
    return features;
  }
  
  /**
   * Calculate similarity score between book features and user preferences
   */
  private calculateScore(book: Book): number {
    const features = this.bookToFeatures(book);
    let score = 0;
    
    // Score each feature against user preferences
    for (const [feature, value] of Object.entries(features)) {
      const [category, name] = feature.split(':');
      
      switch (category) {
        case 'genre':
          score += (this.userPreference.genreWeights[name] || 0) * value;
          break;
        case 'theme':
          score += (this.userPreference.themeWeights[name] || 0) * value;
          break;
        case 'length':
          score += (this.userPreference.lengthWeights[name as keyof typeof this.userPreference.lengthWeights] || 0) * value;
          break;
        case 'era':
          score += (this.userPreference.eraWeights[name as keyof typeof this.userPreference.eraWeights] || 0) * value;
          break;
        case 'complexity':
          score += (this.userPreference.complexityWeights[name as keyof typeof this.userPreference.complexityWeights] || 0) * value;
          break;
        case 'mood':
          score += (this.userPreference.moodWeights[name] || 0) * value;
          break;
      }
    }
    
    return score;
  }
  
  /**
   * Get book recommendations with exploration/exploitation balance
   */
  getRecommendations(count: number = 10, excludeIds: Set<string> = new Set()): Book[] {
    const candidates = this.books.filter(b => !excludeIds.has(b.id));
    
    // Thompson Sampling: probabilistic exploration
    const withExploration = candidates.map(book => {
      const baseScore = this.calculateScore(book);
      
      // Add exploration noise (Gaussian-like distribution centered at base score)
      const explorationNoise = this.userPreference.explorationRate * this.gaussianRandom();
      const finalScore = baseScore + explorationNoise;
      
      return { book, score: finalScore };
    });
    
    // Sort by score and return top recommendations
    return withExploration
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map(item => item.book);
  }
  
  /**
   * Update preferences based on swipe feedback
   */
  recordSwipe(book: Book, liked: boolean): void {
    const features = this.bookToFeatures(book);
    const learningRate = 0.1;
    const sign = liked ? 1 : -1;
    
    // Update weights for each feature
    for (const [feature, value] of Object.entries(features)) {
      const [category, name] = feature.split(':');
      
      switch (category) {
        case 'genre':
          this.userPreference.genreWeights[name] = 
            (this.userPreference.genreWeights[name] || 0) + sign * learningRate * value;
          break;
        case 'theme':
          this.userPreference.themeWeights[name] = 
            (this.userPreference.themeWeights[name] || 0) + sign * learningRate * value;
          break;
        case 'length':
          const lengthKey = name as keyof typeof this.userPreference.lengthWeights;
          this.userPreference.lengthWeights[lengthKey] = 
            this.userPreference.lengthWeights[lengthKey] + sign * learningRate * value;
          break;
        case 'era':
          const eraKey = name as keyof typeof this.userPreference.eraWeights;
          this.userPreference.eraWeights[eraKey] = 
            this.userPreference.eraWeights[eraKey] + sign * learningRate * value;
          break;
        case 'complexity':
          const complexityKey = name as keyof typeof this.userPreference.complexityWeights;
          this.userPreference.complexityWeights[complexityKey] = 
            this.userPreference.complexityWeights[complexityKey] + sign * learningRate * value;
          break;
        case 'mood':
          this.userPreference.moodWeights[name] = 
            (this.userPreference.moodWeights[name] || 0) + sign * learningRate * value;
          break;
      }
    }
    
    // Record swipe history
    this.userPreference.swipeHistory.push({
      bookId: book.id,
      liked,
      timestamp: Date.now()
    });
    
    // Decay exploration rate over time (more confident as we learn)
    const totalSwipes = this.userPreference.swipeHistory.length;
    this.userPreference.explorationRate = Math.max(0.05, 0.3 * Math.exp(-totalSwipes / 20));
  }
  
  /**
   * Get current user preference profile (for debugging/visualization)
   */
  getPreferenceProfile(): UserPreference {
    return { ...this.userPreference };
  }
  
  /**
   * Load saved preferences (e.g., from database)
   */
  loadPreferences(prefs: UserPreference): void {
    this.userPreference = prefs;
  }
  
  /**
   * Generate Gaussian random number for exploration noise
   */
  private gaussianRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  
  /**
   * Get statistics about the recommendation engine state
   */
  getStats(): {
    totalBooks: number;
    totalSwipes: number;
    likes: number;
    dislikes: number;
    explorationRate: number;
  } {
    const likes = this.userPreference.swipeHistory.filter(s => s.liked).length;
    const dislikes = this.userPreference.swipeHistory.filter(s => !s.liked).length;
    
    return {
      totalBooks: this.books.length,
      totalSwipes: this.userPreference.swipeHistory.length,
      likes,
      dislikes,
      explorationRate: this.userPreference.explorationRate
    };
  }
}
