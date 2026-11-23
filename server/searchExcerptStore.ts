import { createHash } from "node:crypto";

/**
 * Page text a search provider already sent with its results, held so that
 * `/page-content` can ground the answer on it instead of downloading the page.
 * Only the fallback search fills it: Parallel answers each result with excerpts
 * picked for the query, a median of about 2,500 characters, of which the
 * result's snippet keeps 400.
 *
 * Keyed on a hash of the query and the URL. Excerpts picked for one query are
 * no grounding for another, an entry only reaches a caller that already sent
 * the same query, and the store holds no query in clear text.
 */
const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 500;

const entries = new Map<string, { text: string; expiresAt: number }>();

function keyOf(query: string, url: string): string {
  return createHash("sha256")
    .update(JSON.stringify([query.trim(), url]))
    .digest("hex");
}

export function rememberSearchExcerpts(
  query: string,
  url: string,
  text: string,
): void {
  const now = Date.now();
  const key = keyOf(query, url);
  entries.delete(key);
  entries.set(key, { text, expiresAt: now + TTL_MS });

  // Insertion order is expiry order, since every entry lives for the same
  // time, so the oldest entries are both the expired and the evictable ones.
  for (const [oldestKey, oldest] of entries) {
    if (entries.size <= MAX_ENTRIES && oldest.expiresAt > now) break;
    entries.delete(oldestKey);
  }
}

export function recallSearchExcerpts(
  query: string,
  url: string,
): string | undefined {
  const key = keyOf(query, url);
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return undefined;
  }
  return entry.text;
}
