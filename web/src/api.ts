export interface User {
  id: number;
  username: string;
  email: string;
  is_admin: number;
  bookLimit: number | null; // null = unlimited
  discoverable?: boolean;
  theme?: unknown; // validated by adoptAccountTheme
}

// Mirrors MineStatus in src/core/lists.ts.
export type MineStatus = "read" | "listened" | "wish" | "reading" | "listening" | "rereading" | "relistening" | null;

export interface ListItem {
  id: number;
  book_id: number;
  ol_key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  first_publish_year: number | null;
  manual: number;
  category_ids: number[];
  created_at: number;
  mine?: MineStatus;
}

export interface Book extends ListItem {
  rank: number;
  review: string | null;
  public: number;
  listened: number;
  updated_at: number;
  synopsis?: string | null;
}

export interface Category {
  id: number;
  name: string;
}

export interface SearchHit {
  key: string;
  title: string;
  author: string;
  coverUrl?: string;
  year?: number;
  added?: boolean;
  bookId?: number;
  mine?: MineStatus;
}

export interface WishlistItem extends ListItem {
  owned: number;
  public: number;
  rank: number;
}

export interface NextUpItem extends WishlistItem {
  reason: "owned" | "friend";
  friendUsername?: string;
}

export interface ReadingItem extends ListItem {
  listening: number;
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
  vetoed_by: number | null;
  vetoedBy: string | null;
  eliminated: number;
  created_at: number;
}

export interface ClubResults {
  voters: number;
  nominations: (ClubNomination & {
    points: number;
    firsts: number;
    seconds: number;
    thirds: number;
    mine: MineStatus;
  })[];
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
  myBallot: number[];
  votedCount: number;
  myVetoUsed: boolean;
  currentPick: (ClubPick & { mine: MineStatus }) | null;
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

// A refused request, with whatever the server said besides the message.
export class ApiError extends Error {
  data: Record<string, unknown>;
  constructor(message: string, data: Record<string, unknown>) {
    super(message);
    this.data = data;
  }
}

let writes = 0;
// How many changes have been sent, for telling whether a read overlapped one.
export const writeCount = () => writes;

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  if (options.method) writes++;
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data: { error?: string } = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, data);
  return data as T;
}
