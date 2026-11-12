/**
 * Seed data for the book recommendation algorithm
 * Each book is tagged with features the algorithm uses to learn preferences
 */

import type { Book } from './recommendations';

export const SEED_BOOKS: Book[] = [
  // ── Literary Fiction ──
  {
    id: 'b001',
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    genres: ['literary-fiction', 'classic'],
    themes: ['wealth', 'love', 'american-dream', 'disillusionment'],
    length: 'short',
    era: 'classic',
    complexity: 'moderate',
    mood: ['melancholic', 'thought-provoking']
  },
  {
    id: 'b002',
    title: 'Beloved',
    author: 'Toni Morrison',
    genres: ['literary-fiction', 'historical-fiction'],
    themes: ['slavery', 'memory', 'motherhood', 'trauma'],
    length: 'medium',
    era: 'modern',
    complexity: 'dense',
    mood: ['dark', 'haunting', 'powerful']
  },
  {
    id: 'b003',
    title: 'A Little Life',
    author: 'Hanya Yanagihara',
    genres: ['literary-fiction', 'contemporary'],
    themes: ['friendship', 'suffering', 'trauma', 'love'],
    length: 'long',
    era: 'contemporary',
    complexity: 'dense',
    mood: ['dark', 'devastating', 'beautiful']
  },
  {
    id: 'b004',
    title: 'Klara and the Sun',
    author: 'Kazuo Ishiguro',
    genres: ['literary-fiction', 'sci-fi'],
    themes: ['artificial-intelligence', 'love', 'loneliness', 'mortality'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['thought-provoking', 'gentle', 'melancholic']
  },

  // ── Science Fiction ──
  {
    id: 'b005',
    title: 'Dune',
    author: 'Frank Herbert',
    genres: ['sci-fi', 'adventure'],
    themes: ['politics', 'ecology', 'religion', 'power'],
    length: 'long',
    era: 'modern',
    complexity: 'dense',
    mood: ['epic', 'adventurous', 'thought-provoking']
  },
  {
    id: 'b006',
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    genres: ['sci-fi', 'literary-fiction'],
    themes: ['gender', 'politics', 'exploration', 'identity'],
    length: 'medium',
    era: 'modern',
    complexity: 'moderate',
    mood: ['thought-provoking', 'adventurous', 'lyrical']
  },
  {
    id: 'b007',
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    genres: ['sci-fi', 'thriller'],
    themes: ['survival', 'science', 'friendship', 'space'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['uplifting', 'exciting', 'humorous']
  },
  {
    id: 'b008',
    title: 'Neuromancer',
    author: 'William Gibson',
    genres: ['sci-fi', 'cyberpunk'],
    themes: ['artificial-intelligence', 'technology', 'identity', 'corporate-power'],
    length: 'medium',
    era: 'modern',
    complexity: 'dense',
    mood: ['dark', 'edgy', 'atmospheric']
  },
  {
    id: 'b009',
    title: 'The Hitchhiker\'s Guide to the Galaxy',
    author: 'Douglas Adams',
    genres: ['sci-fi', 'comedy'],
    themes: ['existentialism', 'adventure', 'absurdity', 'space'],
    length: 'short',
    era: 'modern',
    complexity: 'light',
    mood: ['humorous', 'uplifting', 'absurd']
  },

  // ── Fantasy ──
  {
    id: 'b010',
    title: 'The Name of the Wind',
    author: 'Patrick Rothfuss',
    genres: ['fantasy', 'adventure'],
    themes: ['magic', 'coming-of-age', 'music', 'storytelling'],
    length: 'long',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['lyrical', 'adventurous', 'enchanting']
  },
  {
    id: 'b011',
    title: 'A Wizard of Earthsea',
    author: 'Ursula K. Le Guin',
    genres: ['fantasy', 'classic'],
    themes: ['magic', 'balance', 'coming-of-age', 'identity'],
    length: 'short',
    era: 'modern',
    complexity: 'moderate',
    mood: ['lyrical', 'thought-provoking', 'adventurous']
  },
  {
    id: 'b012',
    title: 'Piranesi',
    author: 'Susanna Clarke',
    genres: ['fantasy', 'mystery'],
    themes: ['memory', 'isolation', 'wonder', 'knowledge'],
    length: 'short',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['enchanting', 'mysterious', 'beautiful']
  },
  {
    id: 'b013',
    title: 'The Fifth Season',
    author: 'N.K. Jemisin',
    genres: ['fantasy', 'sci-fi'],
    themes: ['oppression', 'survival', 'power', 'earth'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'dense',
    mood: ['powerful', 'dark', 'epic']
  },

  // ── Thriller / Mystery ──
  {
    id: 'b014',
    title: 'Gone Girl',
    author: 'Gillian Flynn',
    genres: ['thriller', 'mystery'],
    themes: ['marriage', 'deception', 'identity', 'media'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'light',
    mood: ['dark', 'gripping', 'twisty']
  },
  {
    id: 'b015',
    title: 'The Girl with the Dragon Tattoo',
    author: 'Stieg Larsson',
    genres: ['mystery', 'thriller'],
    themes: ['justice', 'corruption', 'violence', 'investigation'],
    length: 'long',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['dark', 'gripping', 'intense']
  },
  {
    id: 'b016',
    title: 'And Then There Were None',
    author: 'Agatha Christie',
    genres: ['mystery', 'classic'],
    themes: ['murder', 'justice', 'suspense', 'isolation'],
    length: 'short',
    era: 'classic',
    complexity: 'light',
    mood: ['gripping', 'clever', 'suspenseful']
  },
  {
    id: 'b017',
    title: 'The Silent Patient',
    author: 'Alex Michaelides',
    genres: ['thriller', 'mystery'],
    themes: ['psychology', 'silence', 'obsession', 'truth'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'light',
    mood: ['gripping', 'twisty', 'psychological']
  },

  // ── Non-Fiction ──
  {
    id: 'b018',
    title: 'Sapiens',
    author: 'Yuval Noah Harari',
    genres: ['non-fiction', 'history'],
    themes: ['humanity', 'civilization', 'evolution', 'culture'],
    length: 'long',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['thought-provoking', 'illuminating', 'sweeping']
  },
  {
    id: 'b019',
    title: 'The Body',
    author: 'Bill Bryson',
    genres: ['non-fiction', 'science'],
    themes: ['medicine', 'human-body', 'curiosity', 'knowledge'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'light',
    mood: ['humorous', 'fascinating', 'accessible']
  },
  {
    id: 'b020',
    title: 'Thinking, Fast and Slow',
    author: 'Daniel Kahneman',
    genres: ['non-fiction', 'psychology'],
    themes: ['cognition', 'decision-making', 'bias', 'rationality'],
    length: 'long',
    era: 'contemporary',
    complexity: 'dense',
    mood: ['thought-provoking', 'illuminating', 'academic']
  },

  // ── Short & Light Reads ──
  {
    id: 'b021',
    title: 'The Alchemist',
    author: 'Paulo Coelho',
    genres: ['literary-fiction', 'philosophy'],
    themes: ['destiny', 'journey', 'spirituality', 'self-discovery'],
    length: 'short',
    era: 'modern',
    complexity: 'light',
    mood: ['uplifting', 'inspirational', 'fable-like']
  },
  {
    id: 'b022',
    title: 'Convenience Store Woman',
    author: 'Sayaka Murata',
    genres: ['literary-fiction', 'contemporary'],
    themes: ['conformity', 'identity', 'work', 'belonging'],
    length: 'short',
    era: 'contemporary',
    complexity: 'light',
    mood: ['quirky', 'thought-provoking', 'gentle']
  },
  {
    id: 'b023',
    title: 'The Old Man and the Sea',
    author: 'Ernest Hemingway',
    genres: ['literary-fiction', 'classic'],
    themes: ['perseverance', 'nature', 'pride', 'aging'],
    length: 'short',
    era: 'classic',
    complexity: 'moderate',
    mood: ['powerful', 'contemplative', 'beautiful']
  },

  // ── Horror ──
  {
    id: 'b024',
    title: 'The Shining',
    author: 'Stephen King',
    genres: ['horror', 'thriller'],
    themes: ['isolation', 'addiction', 'family', 'madness'],
    length: 'long',
    era: 'modern',
    complexity: 'moderate',
    mood: ['dark', 'terrifying', 'atmospheric']
  },
  {
    id: 'b025',
    title: 'Mexican Gothic',
    author: 'Silvia Moreno-Garcia',
    genres: ['horror', 'gothic'],
    themes: ['decay', 'colonialism', 'poison', 'independence'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['atmospheric', 'creepy', 'gothic']
  },

  // ── Historical Fiction ──
  {
    id: 'b026',
    title: 'All the Light We Cannot See',
    author: 'Anthony Doerr',
    genres: ['historical-fiction', 'literary-fiction'],
    themes: ['war', 'connection', 'science', 'morality'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['beautiful', 'poignant', 'sweeping']
  },
  {
    id: 'b027',
    title: 'Pachinko',
    author: 'Min Jin Lee',
    genres: ['historical-fiction', 'family-saga'],
    themes: ['immigration', 'identity', 'resilience', 'family'],
    length: 'long',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['sweeping', 'powerful', 'moving']
  },
  {
    id: 'b028',
    title: 'The Shadow of the Wind',
    author: 'Carlos Ruiz Zafón',
    genres: ['historical-fiction', 'mystery'],
    themes: ['books', 'love', 'secrets', 'barcelona'],
    length: 'long',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['atmospheric', 'enchanting', 'mysterious']
  },

  // ── Comedy / Humor ──
  {
    id: 'b029',
    title: 'Good Omens',
    author: 'Terry Pratchett & Neil Gaiman',
    genres: ['comedy', 'fantasy'],
    themes: ['apocalypse', 'friendship', 'good-vs-evil', 'absurdity'],
    length: 'medium',
    era: 'modern',
    complexity: 'light',
    mood: ['humorous', 'witty', 'uplifting']
  },
  {
    id: 'b030',
    title: 'Bossypants',
    author: 'Tina Fey',
    genres: ['memoir', 'comedy'],
    themes: ['feminism', 'career', 'humor', 'self-deprecation'],
    length: 'short',
    era: 'contemporary',
    complexity: 'light',
    mood: ['humorous', 'uplifting', 'relatable']
  },

  // ── Romance ──
  {
    id: 'b031',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    genres: ['romance', 'classic'],
    themes: ['love', 'class', 'pride', 'misunderstanding'],
    length: 'medium',
    era: 'classic',
    complexity: 'moderate',
    mood: ['witty', 'romantic', 'uplifting']
  },
  {
    id: 'b032',
    title: 'The Song of Achilles',
    author: 'Madeline Miller',
    genres: ['historical-fiction', 'romance'],
    themes: ['love', 'fate', 'war', 'mythology'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['beautiful', 'tragic', 'lyrical']
  },

  // ── More Sci-Fi ──
  {
    id: 'b033',
    title: 'Exhalation',
    author: 'Ted Chiang',
    genres: ['sci-fi', 'short-stories'],
    themes: ['time', 'consciousness', 'technology', 'free-will'],
    length: 'short',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['thought-provoking', 'beautiful', 'mind-bending']
  },
  {
    id: 'b034',
    title: 'Snow Crash',
    author: 'Neal Stephenson',
    genres: ['sci-fi', 'cyberpunk'],
    themes: ['technology', 'language', 'corporations', 'viruses'],
    length: 'long',
    era: 'modern',
    complexity: 'dense',
    mood: ['edgy', 'humorous', 'adventurous']
  },

  // ── Philosophy / Deep ──
  {
    id: 'b035',
    title: 'The Stranger',
    author: 'Albert Camus',
    genres: ['literary-fiction', 'philosophy'],
    themes: ['absurdism', 'alienation', 'existentialism', 'death'],
    length: 'short',
    era: 'classic',
    complexity: 'moderate',
    mood: ['dark', 'thought-provoking', 'existential']
  },
  {
    id: 'b036',
    title: 'Meditations',
    author: 'Marcus Aurelius',
    genres: ['philosophy', 'classic'],
    themes: ['stoicism', 'self-discipline', 'virtue', 'mortality'],
    length: 'short',
    era: 'classic',
    complexity: 'moderate',
    mood: ['contemplative', 'inspirational', 'timeless']
  },

  // ── Adventure ──
  {
    id: 'b037',
    title: 'Life of Pi',
    author: 'Yann Martel',
    genres: ['adventure', 'literary-fiction'],
    themes: ['survival', 'faith', 'storytelling', 'nature'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['adventurous', 'beautiful', 'thought-provoking']
  },
  {
    id: 'b038',
    title: 'Into the Wild',
    author: 'Jon Krakauer',
    genres: ['non-fiction', 'adventure'],
    themes: ['nature', 'freedom', 'isolation', 'idealism'],
    length: 'short',
    era: 'modern',
    complexity: 'moderate',
    mood: ['adventurous', 'haunting', 'thought-provoking']
  },

  // ── Contemporary / Diverse ──
  {
    id: 'b039',
    title: 'Normal People',
    author: 'Sally Rooney',
    genres: ['literary-fiction', 'romance'],
    themes: ['love', 'class', 'communication', 'young-adulthood'],
    length: 'short',
    era: 'contemporary',
    complexity: 'light',
    mood: ['intimate', 'melancholic', 'relatable']
  },
  {
    id: 'b040',
    title: 'Homegoing',
    author: 'Yaa Gyasi',
    genres: ['historical-fiction', 'family-saga'],
    themes: ['ancestry', 'slavery', 'identity', 'generations'],
    length: 'medium',
    era: 'contemporary',
    complexity: 'moderate',
    mood: ['powerful', 'moving', 'sweeping']
  }
];
