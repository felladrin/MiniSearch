// A result set can miss the page the query actually asked for: an official
// site's schedule or ticket page often ranks below aggregators and fan pages,
// and a promotion of what the search did return cannot summon a page that was
// never in it. This lane asks for that page directly, with a second SearXNG
// query scoped to `site:`, and merges what comes back.
//
// Two conditions have to hold before the second query is worth its latency.
// The query must carry navigation intent ("官网", "排片", "hours", "showtimes"),
// and one of the returned results must already name the site ("disney" and
// disney.com), so the domain is evidence from the search itself rather than a
// guess. No domain is derived from the query alone: probing `<token>.com` would
// turn a search box into a scanner.

import { namedDomain, registrableDomainOf } from "./authorityRanking.ts";

/** How many results one lane may add; the lane is a supplement, not a feed. */
export const MAX_OFFICIAL_LANE_RESULTS = 3;

// The query reaches the server with this ceiling already applied
// (`server/searchEndpointServerHook.ts`), and the `site:` prefix must fit too.
const MAX_QUERY_LENGTH = 2000;

// Words that ask for an official page rather than reporting on one. Chinese has
// no word boundaries to split on, so those phrases are matched in the raw query.
const INTENT_PHRASES = [
  "官网",
  "官方网站",
  "官方站",
  "官方网页",
  "官方页面",
  "片单",
  "排片",
  "场次",
  "票价",
  "营业时间",
  "上映时间",
  "购票",
  "订票",
];

const INTENT_WORDS = new Set([
  "hours",
  "official",
  "opening",
  "pricing",
  "prices",
  "schedule",
  "showtime",
  "showtimes",
  "ticket",
  "tickets",
  "timetable",
]);

export interface OfficialLaneRequest {
  /** The registrable domain the query named, as the second query scopes it. */
  domain: string;
  /** The scoped query sent to the search engines. */
  query: string;
}

/**
 * The second query this search warrants, or null when it warrants none. The
 * domain is taken from the results (`namedDomain`), so this only fires when the
 * official site already appeared somewhere in the set.
 */
export function officialLaneRequest(
  query: string,
  results: [title: string, content: string, url: string][],
): OfficialLaneRequest | null {
  if (!hasNavigationIntent(query)) return null;

  for (const [, , url] of results) {
    const domain = namedDomain(query, url, INTENT_WORDS);
    if (!domain) continue;

    const scopedQuery = buildScopedQuery(domain, query);
    if (scopedQuery) return { domain, query: scopedQuery };
  }

  return null;
}

/**
 * Merges the lane's results into the main set, by URL, with the lane's pages
 * placed behind the pinned first result. The position matters: the ranking
 * keeps the first result where it is and re-sorts only what follows, so a page
 * appended past that window would never be re-sorted at all.
 */
export function mergeOfficialLaneResults(
  mainResults: [title: string, content: string, url: string][],
  laneResults: [title: string, content: string, url: string][],
  domain: string,
): [title: string, content: string, url: string][] {
  if (mainResults.length === 0) return mainResults;

  const seen = new Set(mainResults.map(([, , url]) => normalizeUrl(url)));
  const additions: [title: string, content: string, url: string][] = [];

  for (const result of laneResults) {
    if (additions.length >= MAX_OFFICIAL_LANE_RESULTS) break;

    const [, , url] = result;
    // An engine that ignores `site:` must not smuggle an unrelated host in.
    if (registrableDomainOf(url) !== domain) continue;

    const normalized = normalizeUrl(url);
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    additions.push(result);
  }

  if (additions.length === 0) return mainResults;

  const [firstResult, ...rest] = mainResults;
  return [firstResult, ...additions, ...rest];
}

/**
 * On by default, because a query that asks for an official page and returns one
 * is the case this exists for; `SEARCH_OFFICIAL_LANE_ENABLED=false` turns the
 * extra upstream request off.
 */
export function isOfficialLaneEnabled(): boolean {
  const value = (process.env.SEARCH_OFFICIAL_LANE_ENABLED ?? "")
    .trim()
    .toLowerCase();

  return value !== "false" && value !== "0" && value !== "off";
}

function hasNavigationIntent(query: string): boolean {
  const lowered = query.toLowerCase();

  if (INTENT_PHRASES.some((phrase) => lowered.includes(phrase))) return true;

  return lowered
    .split(/[^\p{L}\p{N}]+/u)
    .some((token) => token.length > 0 && INTENT_WORDS.has(token));
}

function buildScopedQuery(domain: string, query: string): string | null {
  const scopedQuery = `site:${domain} ${query}`;
  return scopedQuery.length <= MAX_QUERY_LENGTH ? scopedQuery : null;
}

/** Trailing slashes and the scheme do not make two spellings of one page. */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}
