export interface User {
  id: number;
  username: string;
  email: string;
  is_admin: number;
  bookLimit: number | null; // null = unlimited
  discoverable?: boolean;
  theme?: unknown; // validated by adoptAccountTheme
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
  synopsis?: string | null;
}

export interface SearchHit {
  key: string;
  title: string;
  author: string;
  coverUrl?: string;
  year?: number;
  added?: boolean;
  bookId?: number;
  mine?: "read" | "reading" | "wishlist";
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

interface ClubPick {
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

// Mirrors ClubStage in src/core/clubs.ts.
export type ClubStage = "nominating" | "voting" | "runoff" | "closed";

export interface ClubSummary {
  id: number;
  name: string;
  description: string | null;
  role: "owner" | "member";
  memberCount: number;
  invitedCount: number;
  stage: ClubStage;
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
    stage: ClubStage;
    created_at: number;
  };
  myRole: "owner" | "member";
  stage: ClubStage;
  members: ClubMember[];
  nominations: ClubNomination[];
  myVote: number | null;
  myVetoUsed: boolean;
  currentPick: ClubPick | null;
  pastPicks: ClubPick[];
}

// Mirrors NotificationItem in src/notifications.ts.
export interface NotificationItem {
  key: string;
  ids: number[];
  type: string;
  actionable: boolean;
  message: string;
  details: string[];
  data: {
    clubId?: number;
    requestId?: number;
    status?: string;
    userId?: number;
    id?: number;
    rejected_at?: number;
  } | null;
  read: boolean;
  created_at: number;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data: { error?: string } = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}
