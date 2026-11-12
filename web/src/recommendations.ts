/**
 * Swipe-Based Book Recommendation Algorithm
 * Client-side version for the web app
 */

export interface Book {
  id: string;
  title: string;
  author: string;
  genres: string[];
  themes: string[];
  length: 'short' | 'medium' | 'long';
  era: 'classic' | 'modern' | 'contemporary';
  complexity: 'light' | 'moderate' | 'dense';
  mood: string[];
  synopsis?: string;
  cover_url?: string | null;
}

export interface Swipe {
  bookId: string;
  liked: boolean;
  timestamp: number;
}

export interface UserPreference {
  genreWeights: Record<string, number>;
  themeWeights: Record<string, number>;
  lengthWeights: Record<'short' | 'medium' | 'long', number>;
  eraWeights: Record<'classic' | 'modern' | 'contemporary', number>;
  complexityWeights: Record<'light' | 'moderate' | 'dense', number>;
  moodWeights: Record<string, number>;
  swipeHistory: Swipe[];
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
      explorationRate: 0.3
    };
  }
  
  private bookToFeatures(book: Book): Record<string, number> {
    const features: Record<string, number> = {};
    
    book.genres.forEach(g => features[`genre:${g}`] = 1);
    book.themes.forEach(t => features[`theme:${t}`] = 1);
    features[`length:${book.length}`] = 1;
    features[`era:${book.era}`] = 1;
    features[`complexity:${book.complexity}`] = 1;
    book.mood.forEach(m => features[`mood:${m}`] = 1);
    
    return features;
  }
  
  private calculateScore(book: Book): number {
    const features = this.bookToFeatures(book);
    let score = 0;
    
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
  
  getRecommendations(count: number = 10, excludeIds: Set<string> = new Set()): Book[] {
    const candidates = this.books.filter(b => !excludeIds.has(b.id));
    
    const withExploration = candidates.map(book => {
      const baseScore = this.calculateScore(book);
      const explorationNoise = this.userPreference.explorationRate * this.gaussianRandom();
      const finalScore = baseScore + explorationNoise;
      
      return { book, score: finalScore };
    });
    
    return withExploration
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map(item => item.book);
  }
  
  recordSwipe(book: Book, liked: boolean, weight: number = 1): void {
    const features = this.bookToFeatures(book);
    const learningRate = 0.1 * weight;
    const sign = liked ? 1 : -1;
    
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
    
    this.userPreference.swipeHistory.push({
      bookId: book.id,
      liked,
      timestamp: Date.now()
    });
    
    const totalSwipes = this.userPreference.swipeHistory.length;
    this.userPreference.explorationRate = Math.max(0.05, 0.3 * Math.exp(-totalSwipes / 20));
  }
  
  getPreferenceProfile(): UserPreference {
    return { ...this.userPreference };
  }
  
  loadPreferences(prefs: UserPreference): void {
    this.userPreference = prefs;
  }
  
  private gaussianRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  
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
