import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, writeCount } from "./api";

const cache = new Map<string, unknown>();
export const clearCache = () => cache.clear();

// A GET whose last reply shows at once while a fresh one loads. Mount one
// per path: key the component if the path can change.
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(() => (path && (cache.get(path) as T)) || null);
  const [error, setError] = useState("");

  const update = useCallback(
    (change: (current: T) => T) =>
      setData((current) => {
        if (current === null || !path) return current;
        const next = change(current);
        cache.set(path, next);
        return next;
      }),
    [path],
  );

  const reload = useCallback(async () => {
    if (!path) return;
    const writes = writeCount();
    try {
      const fresh = await api<T>(path);
      // Something was saved meanwhile, so this reply may predate what's on screen.
      if (cache.has(path) && writes !== writeCount()) return;
      cache.set(path, fresh);
      setData(fresh);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, update, reload };
}
