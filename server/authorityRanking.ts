// A small, explainable nudge toward a result whose domain is the one the query
// named. Retrieval and semantic ranking stay untouched: this bonus only
// applies to results the search already returned, and it can promote a page
// into the six the model actually reads.
//
// The rule is deliberately narrow. A query token has to equal the registrable
// domain's label ("disney" and disney.com), or the label has to be the query's
// own words joined ("disney plus" and disneyplus.com). Substrings are not
// matched, so disneyfan.com gets nothing, and an official page that cannot
// support the year the query asks about is left alone rather than pulled in
// front of fresher reporting.

import { getDomain, getDomainWithoutSuffix } from "tldts";

const GENERIC_QUERY_WORDS = new Set([
  "about",
  "and",
  "are",
  "city",
  "day",
  "for",
  "from",
  "guide",
  "host",
  "how",
  "last",
  "latest",
  "list",
  "model",
  "month",
  "new",
  "newest",
  "news",
  "next",
  "official",
  "page",
  "plus",
  "recent",
  "release",
  "releases",
  "result",
  "results",
  "season",
  "series",
  "site",
  "size",
  "start",
  "started",
  "that",
  "the",
  "this",
  "today",
  "tomorrow",
  "tonight",
  "upcoming",
  "version",
  "was",
  "week",
  "april",
  "august",
  "december",
  "february",
  "january",
  "july",
  "june",
  "march",
  "may",
  "november",
  "october",
  "september",
  "weekend",
  "whats",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "year",
  "yesterday",
  "you",
]);

// The public suffix list, its private section included: a site's label is the
// one in front of the suffix, so bbc.co.uk answers "bbc", and a tenant of a
// shared host (someone.github.io) answers its own name instead of "github".
// Read wrongly, the official lane would scope `site:github.io` and merge pages
// of any tenant.
const SUFFIX_LIST_OPTIONS = { allowPrivateDomains: true };

const SINGLE_TOKEN_BONUS = 0.5;
const DERIVED_LABEL_BONUS = 0.75;

/** The default for callers that have no words to set aside. */
const NO_IGNORED_WORDS: ReadonlySet<string> = new Set();

// A label split into the query's words only counts when at least one of those
// words is long enough to be a name rather than a filler word: "plus size"
// would otherwise let plus-size.com ride on the word "plus". Four characters
// keeps "coca cola" on cocacola.com while the generic-word list still turns
// "plus size" down.
const MIN_DISTINCTIVE_PART_LENGTH = 4;
const MIN_SINGLE_TOKEN_LENGTH = 3;

/**
 * Adds a bonus to a result's semantic score when its site is the one the query
 * names. The reranker returns a raw logit, which is negative for most
 * documents, so the bonus is added rather than multiplied: a factor above one
 * would push a negative score further down and demote the very site it means
 * to promote. `title` and `snippet` are read only for the year guard, so a page
 * unrelated to the year in the query does not get promoted on brand alone.
 */
export function authorityBoost(
  query: string,
  title: string,
  snippet: string,
  url: string,
): number {
  const hostname = hostnameOf(url);
  if (!hostname) return 0;

  const label = registrableLabel(hostname);
  if (!label) return 0;

  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;

  // "+" is how a brand reads, not how a hostname can: "disney+" tokenizes to
  // disney and plus, letting the derived-label rule see disneyplus.com.
  const normalizedQuery = query.replace(/\+/g, " plus ");
  const normalizedTokens = tokenize(normalizedQuery);
  if (normalizedTokens.length === 0) return 0;

  const bonus = matchBonus(label, tokens, normalizedTokens);
  if (bonus === 0) return 0;

  return mentionsQueryYear(query, title, snippet) ? bonus : 0;
}

function matchBonus(
  label: string,
  tokens: string[],
  normalizedTokens: string[],
  ignoredWords: ReadonlySet<string> = NO_IGNORED_WORDS,
): number {
  const distinctiveTokens = tokens.filter(
    (token) =>
      token.length >= MIN_SINGLE_TOKEN_LENGTH &&
      !GENERIC_QUERY_WORDS.has(token) &&
      !ignoredWords.has(token),
  );

  if (distinctiveTokens.includes(label)) return SINGLE_TOKEN_BONUS;

  const split = splitLabelIntoQueryWords(label, normalizedTokens);
  if (!split) return 0;

  // The label has to spell the name the query starts with, not a prefix of a
  // longer question: "tesla investor relations" must not hand
  // teslainvestor.com the bonus for a query that names Tesla's own filings.
  if (GENERIC_QUERY_WORDS.has(split.parts[0])) return 0;

  const leftover = tokens.filter(
    (token) =>
      token.length >= MIN_SINGLE_TOKEN_LENGTH &&
      !GENERIC_QUERY_WORDS.has(token) &&
      !ignoredWords.has(token) &&
      !/^(?:19|20)\d{2}$/.test(token) &&
      !split.parts.includes(token),
  );
  if (leftover.length > 0) return 0;

  // A hyphen is itself evidence of a brand ("coca-cola"), so its parts do not
  // need one long word between them; a plain concatenation does, or "plus
  // size" would hand plus-size.com the boost.
  const hasDistinctivePart = split.parts.some(
    (part) =>
      !GENERIC_QUERY_WORDS.has(part) &&
      (part.length >= MIN_DISTINCTIVE_PART_LENGTH || split.separator === "-"),
  );

  return hasDistinctivePart ? DERIVED_LABEL_BONUS : 0;
}

/**
 * Returns the query words that spell the label, in order and with nothing
 * left over, or null when the label is not fully accounted for. "disneyplus"
 * splits into disney + plus; "cocacola" does not split into anything.
 */
function splitLabelIntoQueryWords(
  label: string,
  tokens: string[],
): { parts: string[]; separator: string } | null {
  for (const separator of ["-", ""]) {
    const parts = trySplit(label, tokens, separator);
    if (parts) return { parts, separator };
  }

  return null;
}

function trySplit(
  label: string,
  tokens: string[],
  separator: string,
): string[] | null {
  const candidates = tokens.filter((token) => token.length >= 2);
  if (candidates.length < 2) return null;

  for (let index = 0; index < candidates.length; index++) {
    const parts: string[] = [];
    let position = 0;

    for (let cursor = index; cursor < candidates.length; cursor++) {
      const token = candidates[cursor];
      const expected =
        separator === "" ? token : parts.length ? separator + token : token;

      if (!label.startsWith(expected, position)) break;

      parts.push(token);
      position += expected.length;

      if (position === label.length && parts.length >= 2) return parts;
    }
  }

  return null;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * The registrable domain of a URL, or null when the URL cannot be parsed or
 * carries no registrable part. shop.disney.com and disney.com both answer
 * "disney.com", which is what the official-lane search scopes with `site:`.
 */
export function registrableDomainOf(url: string): string | null {
  const hostname = hostnameOf(url);
  return hostname ? getDomain(hostname, SUFFIX_LIST_OPTIONS) : null;
}

/**
 * The registrable domain of a result when the query names it, or null. The rule
 * is the one the score bonus uses, so a site the boost would promote is exactly
 * a site this can be scoped to. The year guard is not part of it: the caller
 * only asks whether the site is the one the query named, not whether its page
 * is about the right edition. Words in `ignoredWords` do not count as
 * leftover, which lets a caller treat its own intent words as understood.
 */
export function namedDomain(
  query: string,
  url: string,
  ignoredWords: ReadonlySet<string> = NO_IGNORED_WORDS,
): string | null {
  const hostname = hostnameOf(url);
  if (!hostname) return null;

  const label = registrableLabel(hostname);
  if (!label) return null;

  const tokens = tokenize(query);
  if (tokens.length === 0) return null;

  const normalizedTokens = tokenize(query.replace(/\+/g, " plus "));
  if (normalizedTokens.length === 0) return null;

  if (matchBonus(label, tokens, normalizedTokens, ignoredWords) === 0) {
    return null;
  }

  return registrableDomainOf(url);
}

function hostnameOf(url: string): string | null {
  try {
    // A trailing dot is the same host spelled absolutely: "disney.com.".
    const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * The label of the registrable domain: disney.com and shop.disney.com both
 * answer "disney". A two-part public suffix (co.uk) keeps its own label.
 */
function registrableLabel(hostname: string): string | null {
  return getDomainWithoutSuffix(hostname, SUFFIX_LIST_OPTIONS) || null;
}

/**
 * A brand page for last year's event is not the page for this year's. When the
 * query carries a year, a result that states a different year is the wrong
 * page, so authority alone does not move it up. A result that states no year
 * at all is kept: relative-time queries are anchored to a year before they
 * reach the search ("next month December 2026"), and a page that writes only
 * "December" is the page that query meant.
 */
function mentionsQueryYear(
  query: string,
  title: string,
  snippet: string,
): boolean {
  const years = query.match(/\b(?:19|20)\d{2}\b/g);
  if (!years) return true;

  const page = `${title} ${snippet}`;
  if (years.some((year) => page.includes(year))) return true;

  return !/\b(?:19|20)\d{2}\b/.test(page);
}
