const BASE = "https://openlibrary.org";
const USER_AGENT = "bookrecs/1.0 (personal book tracking app)";

const coverUrl = (id: number, size: "M" | "L" = "M") => `https://covers.openlibrary.org/b/id/${id}-${size}.jpg`;

export interface OLWork {
  key: string;
  title: string;
  author: string;
  coverUrl?: string;
  year?: number;
  synopsis?: string;
}

export interface OLHit {
  key: string;
  title: string;
  author: string;
  coverUrl?: string;
  year?: number;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Open Library responded ${res.status}`);
  return res.json();
}

function yearFrom(dateStr?: string): number | undefined {
  if (!dateStr) return undefined;
  const m = dateStr.match(/(\d{4})/);
  return m ? Number(m[1]) : undefined;
}

// ---------- English author names ----------

// Non-Latin scripts (Cyrillic, Greek, CJK, Arabic, Indic, Hangul, ...).
const NON_LATIN = /[\u0370-\u03FF\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;

export function isLatin(s: string): boolean {
  return !NON_LATIN.test(s);
}

// "Surname, Given Names" -> "Given Names Surname"
function reverseName(s: string): string {
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  return s;
}

const WIKIDATA = "https://www.wikidata.org/wiki/Special:EntityData";
const authorNameCache = new Map<string, string>();

// Resolve an Open Library author key (/authors/OL123A) to an English name.
// Preferred source is the Wikidata English label; falls back to Open Library's
// own fields (already in the Latin alphabet) when Wikidata is unavailable.
async function englishAuthorName(key: string): Promise<string> {
  const cached = authorNameCache.get(key);
  if (cached !== undefined) return cached;

  let result = "";
  try {
    const d = await getJson(`${BASE}${key}.json`);
    const qid: unknown = d?.remote_ids?.wikidata;

    if (typeof qid === "string" && qid) {
      try {
        const wd = await getJson(`${WIKIDATA}/${encodeURIComponent(qid)}.json`);
        const labels: Record<string, any> = wd?.entities?.[qid]?.labels ?? {};
        const en = typeof labels.en?.value === "string" ? labels.en.value : "";
        if (en) {
          result = en;
        } else {
          for (const v of Object.values(labels)) {
            const val = (v as any)?.value;
            if (typeof val === "string" && isLatin(val)) {
              result = val;
              break;
            }
          }
        }
      } catch {
        // fall through to Open Library fields below
      }
    }

    if (!result) {
      const name: string = d?.name ?? "";
      const personal: string = d?.personal_name ?? "";
      if (personal && isLatin(personal)) result = reverseName(personal);
      else if (name && isLatin(name)) result = name;
      else if (name) result = name;
    }
  } catch {
    // could not resolve; leave empty
  }

  authorNameCache.set(key, result);
  return result;
}

// ---------- English titles ----------

// Works surface in Open Library under their original-language title (the
// Russian "Братья Карамазовы", the German "Die Verwandlung", ...). Work
// records don't link to Wikidata, so to display an English title we look at
// the work's own English-language editions and use their most common title.
const englishTitleCache = new Map<string, string>();

// Fraction of words that start with a capital letter — used to prefer
// "The Brothers Karamazov" over the equally-common "The brothers Karamazov".
function titleCaseScore(s: string): number {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const capped = words.filter((w) => /^[A-Z]/.test(w)).length;
  return capped / words.length;
}

async function englishTitle(key: string): Promise<string> {
  const cached = englishTitleCache.get(key);
  if (cached !== undefined) return cached;

  let result = "";
  try {
    const d = await getJson(`${BASE}${key}/editions.json?limit=500`);
    const entries: any[] = Array.isArray(d?.entries) ? d.entries : [];
    let best: { title: string; n: number } | null = null;
    const counts = new Map<string, { title: string; n: number }>();

    for (const e of entries) {
      const title: unknown = e?.title;
      if (typeof title !== "string" || !title.trim() || !isLatin(title)) continue;
      const langs: any[] = Array.isArray(e?.languages) ? e.languages : [];
      if (!langs.some((l) => typeof l?.key === "string" && l.key.endsWith("/eng"))) continue;
      // "The Brothers Karamazov" / "the brothers karamazov" / "Brothers
      // Karamazov" are all the same title to a reader — count them together.
      const norm = title
        .toLowerCase()
        .replace(/^(the|a|an)\s+/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!norm) continue;
      const cur = counts.get(norm) ?? { title, n: 0 };
      cur.n += 1;
      counts.set(norm, cur);
    }

    for (const c of counts.values()) {
      if (
        !best ||
        c.n > best.n ||
        (c.n === best.n &&
          (titleCaseScore(c.title) > titleCaseScore(best.title) ||
            (titleCaseScore(c.title) === titleCaseScore(best.title) && c.title.length < best.title.length)))
      ) {
        best = c;
      }
    }
    result = best?.title ?? "";
  } catch {
    // could not resolve; leave empty
  }

  englishTitleCache.set(key, result);
  return result;
}

export async function searchBooks(query: string): Promise<OLHit[]> {
  const url =
    `${BASE}/search.json?q=${encodeURIComponent(query)}` +
    `&fields=key,title,author_name,author_key,cover_i,first_publish_year&limit=20`;
  const data = await getJson(url);
  const docs: any[] = data?.docs ?? [];
  const hits = docs.map((d) => ({
    key: d.key,
    title: d.title ?? "Unknown title",
    author: Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name ?? ""),
    coverUrl: d.cover_i ? coverUrl(d.cover_i) : undefined,
    year: d.first_publish_year ?? undefined,
  }));

  // Open Library's search index shows the author as named on the original
  // work ("Фёдор Михайлович Достоевский"), which reads as noise next to an
  // English title. author_name and author_key are parallel arrays, so
  // resolve non-Latin author names to their English form — same as when a
  // book is added. Results usually share a handful of authors, and
  // englishAuthorName caches, so this is a few requests at most.
  const authorKeyOf = (d: any): string | undefined =>
    Array.isArray(d.author_key) ? d.author_key[0] : typeof d.author_key === "string" ? d.author_key : undefined;
  const foreignKeys = new Set<string>();
  docs.forEach((d, i) => {
    const key = authorKeyOf(d);
    if (hits[i].author && !isLatin(hits[i].author) && key) foreignKeys.add(key);
  });
  if (foreignKeys.size > 0) {
    await Promise.all(
      [...foreignKeys].slice(0, 10).map(async (k) => {
        const en = await englishAuthorName(`/authors/${k}`);
        if (!en || !isLatin(en)) return;
        docs.forEach((d, i) => {
          if (authorKeyOf(d) === k) hits[i].author = en;
        });
      }),
    );
  }

  let ranked: OLHit[] = hits;

  // Open Library ranks by relevance across all languages, so a search for
  // "Brother Karamazov" puts the Russian "Братья Карамазовы" first. For a
  // Latin-script query, keep relevance order but put Latin-script titles
  // ahead of foreign-script ones.
  if (isLatin(query)) {
    const latin = ranked.filter((h) => isLatin(h.title));
    const foreign = ranked.filter((h) => !isLatin(h.title));
    ranked = [...latin, ...foreign];
  }

  return ranked;
}

export async function fetchWork(key: string): Promise<OLWork | null> {
  try {
    const d = await getJson(`${BASE}${key}.json`);
    if (!d?.title) return null;

    // A foreign-script title ("Братья Карамазовы") reads awkwardly next to
    // the English author name we resolve below — display the work's English
    // edition title instead when one exists.
    let title: string = d.title;
    if (!isLatin(title)) {
      const en = await englishTitle(key);
      if (en) title = en;
    }

    const authorKeys: string[] = (d.authors ?? [])
      .map((a: any) => a?.author?.key ?? a?.key)
      .filter((k: unknown): k is string => typeof k === "string");
    const names: string[] = [];
    for (let i = 0; i < Math.min(authorKeys.length, 3); i++) {
      const n = await englishAuthorName(authorKeys[i]);
      if (n) names.push(n);
    }
    const coverId = (d.covers ?? []).find((c: any) => typeof c === "number" && c > 0);

    // Extract synopsis/description
    let synopsis: string | undefined;
    const desc = d.description;
    if (desc) {
      if (typeof desc === "string") {
        synopsis = desc;
      } else if (typeof desc === "object" && desc.value) {
        synopsis = desc.value;
      }
    }

    return {
      key,
      title,
      author: names.join(", "),
      coverUrl: typeof coverId === "number" ? coverUrl(coverId) : undefined,
      year: yearFrom(d.first_publish_date),
      synopsis,
    };
  } catch {
    return null;
  }
}

// Fetch synopsis for a book by its ol_key
export async function fetchSynopsis(olKey: string): Promise<string | null> {
  try {
    const work = await fetchWork(olKey);
    return work?.synopsis ?? null;
  } catch {
    return null;
  }
}
