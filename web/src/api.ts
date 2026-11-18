export interface User {
  id: number;
  username: string;
  email: string;
  is_admin: number;
  bookLimit: number | null; // null = unlimited
  discoverable?: boolean;
}

export interface Book {
  id: number;
  book_id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  rank: number;
  review: string | null;
  public: number;
  created_at: number;
  updated_at: number;
  mine?: "read" | "wish" | "reading" | null;
  isReading?: boolean;
}

export interface SearchHit {
  key: string;
  title: string;
  author: string;
  coverUrl?: string;
  year?: number;
  added?: boolean;
}

export interface WishlistItem {
  book_id: number;
  owned: number;
  public: number;
  rank: number;
  created_at: number;
  id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  mine?: "read" | "wish" | "reading" | null;
}

export interface NextUpItem extends WishlistItem {
  reason: "owned" | "friend";
  friendUsername?: string;
}

export interface ReadingItem {
  book_id: number;
  created_at: number;
  id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  mine?: "read" | "wish" | "reading" | null;
}

export interface ClubPick {
  id: number;
  book_id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  picked_at: number;
}

export interface ClubSummary {
  id: number;
  name: string;
  description: string | null;
  role: "owner" | "member";
  memberCount: number;
  voting_open: number;
  nominationCount: number;
  currentPick: ClubPick | null;
  created_at: number;
}

export interface ClubInvite {
  clubId: number;
  name: string;
  description: string | null;
  inviter: string | null;
  invited_at: number;
}

export interface ClubMember {
  user_id: number;
  username: string;
  role: "owner" | "member";
  status: "pending" | "accepted";
  joined_at: number;
}

export interface ClubNomination {
  id: number;
  book_id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  user_id: number;
  nominatedBy: string;
  votes: number;
  vetoed_by: number | null;
  vetoedBy: string | null;
  created_at: number;
}

export interface ClubDetailData {
  club: {
    id: number;
    name: string;
    description: string | null;
    creator_id: number;
    voting_open: number;
    created_at: number;
  };
  myRole: "owner" | "member";
  votingOpen: boolean;
  runoff: boolean;
  members: ClubMember[];
  nominations: ClubNomination[];
  myVote: number | null;
  myVetoUsed: boolean;
  currentPick: ClubPick | null;
  pastPicks: ClubPick[];
}


export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}
