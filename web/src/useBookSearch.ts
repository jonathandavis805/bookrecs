import { useEffect, useState } from "react";
import { api, errorMessage, type SearchHit } from "./api";

// Debounced book search. `searched` is the query the hits are for; they stay
// up while the next query loads.
export function useBookSearch(q: string, mine = false) {
  const query = q.trim();
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setSearching(!!query);
    if (!query) {
      setHits([]);
      setSearched("");
      return;
    }

    // Replies can arrive out of order, so a superseded request must not land.
    const request = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const path = `/api/books/search?${mine ? "mine=1&" : ""}q=${encodeURIComponent(query)}`;
        const d = await api<{ results: SearchHit[] }>(path, { signal: request.signal });
        if (request.signal.aborted) return;
        setHits(d.results);
        setSearched(query);
      } catch (e) {
        if (!request.signal.aborted) setError(errorMessage(e));
      } finally {
        if (!request.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [query, mine]);

  return { hits, searched, searching, error };
}
