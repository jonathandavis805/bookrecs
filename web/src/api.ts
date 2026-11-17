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
