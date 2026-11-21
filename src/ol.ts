const BASE = "https://openlibrary.org";
const WIKIDATA = "https://www.wikidata.org/wiki/Special:EntityData";
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

// The parts of Open Library and Wikidata responses this module reads.
interface WorkJson {
  title?: string;
  authors?: { author?: { key?: string }; key?: string }[];
  covers?: number[];
  first_publish_date?: string;
  description?: string | { value?: string };
}
interface AuthorJson {
  name?: string;
  personal_name?: string;
  remote_ids?: { wikidata?: string };
}
interface EditionsJson {
  entries?: { title?: string; languages?: { key?: string }[] }[];
}
interface SearchJson {
  docs?: {
    key: string;
    title?: string;
    author_name?: string[];
    author_key?: string[];
    cover_i?: number;
    first_publish_year?: number;
  }[];
}
interface WikidataJson {
  entities?: Record<string, { labels?: Record<string, { value?: string }> }>;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Open Library responded ${res.status}`);
  return (await res.json()) as T;
}

const yearFrom = (date?: string) => {
  const m = date?.match(/(\d{4})/);
  return m ? Number(m[1]) : undefined;
};

// Non-Latin scripts (Cyrillic, Greek, CJK, Arabic, Indic, Hangul, ...).
const NON_LATIN = /[Ͱ-ϿЀ-ӿ؀-ۿऀ-ॿ぀-ヿ㐀-鿿가-힯]/;

export function isLatin(s: string): boolean {
  return !NON_LATIN.test(s);
}

// "The Brothers Karamazov", "the brothers karamazov" and "Brothers Karamazov"
// are the same title to a reader.
export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// "Surname, Given Names" -> "Given Names Surname"
function reverseName(s: string): string {
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : s;
}

// ---------- English author names ----------

const authorNameCache = new Map<string, string>();

// Resolve an Open Library author key (/authors/OL123A) to an English name.
// Preferred source is the Wikidata English label; falls back to Open Library's
// own fields when Wikidata is unavailable.
async function englishAuthorName(key: string): Promise<string> {
  const cached = authorNameCache.get(key);
  if (cached !== undefined) return cached;

  let result = "";
  try {
    const author = await getJson<AuthorJson>(`${BASE}${key}.json`);
    const qid = author.remote_ids?.wikidata;
    if (qid) {
      try {
        const wd = await getJson<WikidataJson>(`${WIKIDATA}/${encodeURIComponent(qid)}.json`);
        const labels = wd.entities?.[qid]?.labels ?? {};
        result =
          (labels.en?.value ||
            Object.values(labels)
              .map((l) => l.value ?? "")
              .find(isLatin)) ??
          "";
      } catch {
        // fall through to Open Library fields below
      }
    }
    if (!result) {
      const { name = "", personal_name: personal = "" } = author;
      result = personal && isLatin(personal) ? reverseName(personal) : name;
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
  return words.length ? words.filter((w) => /^[A-Z]/.test(w)).length / words.length : 0;
}

async function englishTitle(key: string): Promise<string> {
  const cached = englishTitleCache.get(key);
  if (cached !== undefined) return cached;

  let result = "";
  try {
    const { entries = [] } = await getJson<EditionsJson>(`${BASE}${key}/editions.json?limit=500`);
    const counts = new Map<string, { title: string; n: number }>();
    for (const e of entries) {
      const title = e.title?.trim();
      if (!title || !isLatin(title)) continue;
      if (!e.languages?.some((l) => l.key?.endsWith("/eng"))) continue;
      const norm = normalizeTitle(title);
      if (!norm) continue;
      const cur = counts.get(norm) ?? { title, n: 0 };
      cur.n += 1;
      counts.set(norm, cur);
    }
    const better = (a: { title: string; n: number }, b: { title: string; n: number }) =>
      a.n - b.n || titleCaseScore(a.title) - titleCaseScore(b.title) || b.title.length - a.title.length;
    result = [...counts.values()].sort((a, b) => better(b, a))[0]?.title ?? "";
  } catch {
    // could not resolve; leave empty
  }
  englishTitleCache.set(key, result);
  return result;
}

// ---------- Search and works ----------

export async function searchBooks(query: string): Promise<OLHit[]> {
  const { docs = [] } = await getJson<SearchJson>(
    `${BASE}/search.json?q=${encodeURIComponent(query)}` +
      "&fields=key,title,author_name,author_key,cover_i,first_publish_year&limit=20",
  );
  const hits: OLHit[] = docs.map((d) => ({
    key: d.key,
    title: d.title ?? "Unknown title",
    author: d.author_name?.[0] ?? "",
    coverUrl: d.cover_i ? coverUrl(d.cover_i) : undefined,
    year: d.first_publish_year,
  }));

  // Open Library's search index shows the author as named on the original
  // work ("Фёдор Михайлович Достоевский"), which reads as noise next to an
  // English title. Resolve non-Latin author names to their English form —
  // same as when a book is added. Results usually share a handful of authors,
  // and englishAuthorName caches, so this is a few requests at most.
  const foreignKeys = new Set(
    docs.flatMap((d, i) => (d.author_key?.[0] && !isLatin(hits[i].author) ? [d.author_key[0]] : [])),
  );
  await Promise.all(
    [...foreignKeys].slice(0, 10).map(async (k) => {
      const en = await englishAuthorName(`/authors/${k}`);
      if (!en || !isLatin(en)) return;
      docs.forEach((d, i) => {
        if (d.author_key?.[0] === k) hits[i].author = en;
      });
    }),
  );
  return hits;
}

function descriptionOf(work: WorkJson): string | undefined {
  const desc = work.description;
  return typeof desc === "string" ? desc : desc?.value || undefined;
}

export async function fetchWork(key: string): Promise<OLWork | null> {
  try {
    const work = await getJson<WorkJson>(`${BASE}${key}.json`);
    if (!work.title) return null;

    // A foreign-script title ("Братья Карамазовы") reads awkwardly next to
    // the English author name resolved below — use the work's English
    // edition title instead when one exists.
    const title = isLatin(work.title) ? work.title : (await englishTitle(key)) || work.title;

    const authorKeys = (work.authors ?? [])
      .map((a) => a.author?.key ?? a.key)
      .filter((k): k is string => typeof k === "string")
      .slice(0, 3);
    const names: string[] = [];
    for (const k of authorKeys) {
      const n = await englishAuthorName(k);
      if (n) names.push(n);
    }
    const coverId = work.covers?.find((c) => c > 0);

    return {
      key,
      title,
      author: names.join(", "),
      coverUrl: coverId ? coverUrl(coverId) : undefined,
      year: yearFrom(work.first_publish_date),
      synopsis: descriptionOf(work),
    };
  } catch {
    return null;
  }
}

export async function fetchSynopsis(olKey: string): Promise<string | null> {
  try {
    return descriptionOf(await getJson<WorkJson>(`${BASE}${olKey}.json`)) ?? null;
  } catch {
    return null;
  }
}
