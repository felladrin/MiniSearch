// A small, explainable nudge toward a result whose domain is the one the query
// named. Retrieval and semantic ranking stay untouched: this multiplier only
// applies to results the search already returned, and it can promote a page
// into the six the model actually reads.
//
// The rule is deliberately narrow. A query token has to equal the registrable
// domain's label ("disney" and disney.com), or the label has to be the query's
// own words joined ("disney plus" and disneyplus.com). Substrings are not
// matched, so disneyfan.com gets nothing, and an official page that cannot
// support the year the query asks about is left alone rather than pulled in
// front of fresher reporting.

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
  "version",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "year",
  "you",
]);

const SECOND_LEVEL_SUFFIXES = new Set([
  "ac.uk",
  "co.in",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.uk",
  "com.ar",
  "com.au",
  "com.br",
  "com.cn",
  "com.mx",
  "com.sg",
  "com.tr",
  "com.tw",
  "gov.uk",
  "net.au",
  "org.uk",
  "org.au",
]);

const SINGLE_TOKEN_MULTIPLIER = 1.2;
const DERIVED_LABEL_MULTIPLIER = 1.25;

// A label split into the query's words only counts when at least one of those
// words is long enough to be a name rather than a filler word: "plus size"
// would otherwise let plus-size.com ride on the word "plus".
const MIN_DISTINCTIVE_PART_LENGTH = 5;
const MIN_SINGLE_TOKEN_LENGTH = 3;

/**
 * Multiplies a result's semantic score when its site is the one the query
 * names. `title` and `snippet` are read only for the year guard, so a page
 * unrelated to the year in the query does not get promoted on brand alone.
 */
export function authorityBoostMultiplier(
  query: string,
  title: string,
  snippet: string,
  url: string,
): number {
  const hostname = hostnameOf(url);
  if (!hostname) return 1;

  const label = registrableLabel(hostname);
  if (!label) return 1;

  const tokens = tokenize(query);
  if (tokens.length === 0) return 1;

  // "+" is how a brand reads, not how a hostname can: "disney+" tokenizes to
  // disney and plus, letting the derived-label rule see disneyplus.com.
  const normalizedQuery = query.replace(/\+/g, " plus ");
  const normalizedTokens = tokenize(normalizedQuery);
  if (normalizedTokens.length === 0) return 1;

  const multiplier = matchMultiplier(label, tokens, normalizedTokens);
  if (multiplier === 1) return 1;

  return mentionsQueryYear(query, title, snippet) ? multiplier : 1;
}

function matchMultiplier(
  label: string,
  tokens: string[],
  normalizedTokens: string[],
): number {
  const distinctiveTokens = tokens.filter(
    (token) =>
      token.length >= MIN_SINGLE_TOKEN_LENGTH &&
      !GENERIC_QUERY_WORDS.has(token),
  );

  if (distinctiveTokens.includes(label)) return SINGLE_TOKEN_MULTIPLIER;

  const split = splitLabelIntoQueryWords(label, normalizedTokens);
  if (!split) return 1;

  // A hyphen is itself evidence of a brand ("coca-cola"), so its parts do not
  // need one long word between them; a plain concatenation does, or "plus
  // size" would hand plus-size.com the boost.
  const hasDistinctivePart = split.parts.some(
    (part) =>
      !GENERIC_QUERY_WORDS.has(part) &&
      (part.length >= MIN_DISTINCTIVE_PART_LENGTH || split.separator === "-"),
  );

  return hasDistinctivePart ? DERIVED_LABEL_MULTIPLIER : 1;
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

function hostnameOf(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
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
  const labels = hostname.split(".");
  if (labels.length < 2) return null;

  const lastTwo = labels.slice(-2).join(".");
  const index = SECOND_LEVEL_SUFFIXES.has(lastTwo)
    ? labels.length - 3
    : labels.length - 2;

  const label = labels[index];
  return label && label.length > 0 ? label : null;
}

/**
 * A brand page for last year's event is not the page for this year's. When the
 * query carries a year, a result that never mentions it is not the page the
 * query meant, so authority alone does not move it up.
 */
function mentionsQueryYear(
  query: string,
  title: string,
  snippet: string,
): boolean {
  const years = query.match(/\b(?:19|20)\d{2}\b/g);
  if (!years) return true;

  return years.some((year) => `${title} ${snippet}`.includes(year));
}
