/**
 * Absolute anchors for the relative time words a search query can carry.
 *
 * "明年的wrestlemania在哪里举办" reaches the retrieval layer with no year in it,
 * so it matches undated pages and the answer flips between guesses. Appending
 * the resolved year is enough to bring the official announcement into reach.
 *
 * The clock is a parameter and never `Date.now()`, so a caller can anchor a
 * whole batch of queries to one instant and the tests stay deterministic.
 *
 * Only month and year words get an anchor. A day word would need an ISO date
 * ("2026-11-04"), which is not how pages write dates, and many queries use
 * those words as names ("usa today", "the day after tomorrow").
 */

export type RelativeDateReplacement = { phrase: string; anchor: string };

/** Past two anchors a query gains digits without gaining meaning. */
const MAX_REPLACEMENTS = 2;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

interface Rule {
  /** Matched case-insensitively, which is a no-op for the Chinese phrases. */
  phrase: string;
  /**
   * English triggers only match on word boundaries: "this yearly" and
   * "next monthly" are not time references.
   */
  wordBounded: boolean;
  anchor: (asOf: Date) => string;
}

interface Occurrence {
  start: number;
  end: number;
}

interface Hit extends Occurrence {
  /** The matched text spelled as the query spells it, kept for the caller. */
  phrase: string;
  anchor: string;
}

/**
 * Month arithmetic in local calendar terms: December plus one month is January
 * of the next year, not a wrapped month inside the same one.
 */
function shiftMonths(
  asOf: Date,
  months: number,
): { year: number; monthIndex: number } {
  const absoluteMonth = asOf.getMonth() + months;
  const year = asOf.getFullYear() + Math.floor(absoluteMonth / 12);
  // `%` keeps the sign of its left operand, so a December-bound negative
  // offset needs the extra lap before it becomes a month index.
  const monthIndex = ((absoluteMonth % 12) + 12) % 12;
  return { year, monthIndex };
}

function chineseMonthAnchor(asOf: Date, months: number): string {
  const { year, monthIndex } = shiftMonths(asOf, months);
  return `${year}年${monthIndex + 1}月`;
}

function englishMonthAnchor(asOf: Date, months: number): string {
  const { year, monthIndex } = shiftMonths(asOf, months);
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

const RULES: readonly Rule[] = [
  {
    phrase: "明年",
    wordBounded: false,
    anchor: (asOf) => `${asOf.getFullYear() + 1}年`,
  },
  {
    phrase: "今年",
    wordBounded: false,
    anchor: (asOf) => `${asOf.getFullYear()}年`,
  },
  {
    phrase: "去年",
    wordBounded: false,
    anchor: (asOf) => `${asOf.getFullYear() - 1}年`,
  },
  {
    phrase: "下个月",
    wordBounded: false,
    anchor: (asOf) => chineseMonthAnchor(asOf, 1),
  },
  {
    phrase: "下月",
    wordBounded: false,
    anchor: (asOf) => chineseMonthAnchor(asOf, 1),
  },
  {
    phrase: "上个月",
    wordBounded: false,
    anchor: (asOf) => chineseMonthAnchor(asOf, -1),
  },
  {
    phrase: "上月",
    wordBounded: false,
    anchor: (asOf) => chineseMonthAnchor(asOf, -1),
  },
  {
    phrase: "这个月",
    wordBounded: false,
    anchor: (asOf) => chineseMonthAnchor(asOf, 0),
  },
  {
    phrase: "本月",
    wordBounded: false,
    anchor: (asOf) => chineseMonthAnchor(asOf, 0),
  },
  {
    phrase: "next year",
    wordBounded: true,
    anchor: (asOf) => `${asOf.getFullYear() + 1}`,
  },
  {
    phrase: "this year",
    wordBounded: true,
    anchor: (asOf) => `${asOf.getFullYear()}`,
  },
  {
    phrase: "last year",
    wordBounded: true,
    anchor: (asOf) => `${asOf.getFullYear() - 1}`,
  },
  {
    phrase: "next month",
    wordBounded: true,
    anchor: (asOf) => englishMonthAnchor(asOf, 1),
  },
  {
    phrase: "last month",
    wordBounded: true,
    anchor: (asOf) => englishMonthAnchor(asOf, -1),
  },
  {
    phrase: "this month",
    wordBounded: true,
    anchor: (asOf) => englishMonthAnchor(asOf, 0),
  },
];

/**
 * Titles and longer words that contain a trigger but are not time references.
 * "登上月球" (landing on the Moon) holds 上月, "next year's" is the possessive
 * of titles and headlines, and "the last year of college" is the final year,
 * not 2025.
 */
const BLACKLIST_PHRASES: readonly string[] = [
  "明年今日",
  "去年冬天",
  "去年夏天",
  "上月球",
  "next year's",
  "last month of",
  "last year of",
];

function isAsciiLetter(char: string): boolean {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");
}

function findOccurrences(
  text: string,
  phrase: string,
  wordBounded: boolean,
): Occurrence[] {
  const haystack = text.toLowerCase();
  const needle = phrase.toLowerCase();
  const occurrences: Occurrence[] = [];
  let from = 0;

  while (from + needle.length <= haystack.length) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) break;

    const end = start + needle.length;
    const touchesWord =
      wordBounded &&
      (isAsciiLetter(haystack.charAt(start - 1)) ||
        isAsciiLetter(haystack.charAt(end)));

    if (touchesWord) {
      from = start + 1;
      continue;
    }

    occurrences.push({ start, end });
    from = end;
  }

  return occurrences;
}

function overlaps(occurrence: Occurrence, ranges: readonly Occurrence[]) {
  return ranges.some(
    (range) => occurrence.start < range.end && range.start < occurrence.end,
  );
}

export function normalizeRelativeDates(
  query: string,
  asOfDate: Date,
  options?: { maxLength?: number },
): { searchQuery: string; replacements: RelativeDateReplacement[] } {
  const unchanged = {
    searchQuery: query,
    replacements: [] as RelativeDateReplacement[],
  };

  if (query.trim() === "") return unchanged;

  const blacklistRanges = BLACKLIST_PHRASES.flatMap((phrase) =>
    findOccurrences(query, phrase, false),
  );

  const hits: Hit[] = [];
  for (const rule of RULES) {
    for (const occurrence of findOccurrences(
      query,
      rule.phrase,
      rule.wordBounded,
    )) {
      // A trigger inside a title or a longer word is a false positive; the
      // blacklist owns that run of text.
      if (overlaps(occurrence, blacklistRanges)) continue;

      hits.push({
        ...occurrence,
        phrase: query.slice(occurrence.start, occurrence.end),
        anchor: rule.anchor(asOfDate),
      });
    }
  }

  if (hits.length === 0) return unchanged;

  hits.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start),
  );

  const selected: Hit[] = [];
  const usedAnchors = new Set<string>();

  for (const hit of hits) {
    if (selected.length === MAX_REPLACEMENTS) break;
    if (usedAnchors.has(hit.anchor)) continue;
    if (selected.some((chosen) => overlaps(hit, [chosen]))) continue;
    // An anchor the query already spells out is not worth repeating: the
    // search engine has that year already, and a doubled anchor only dilutes
    // the query.
    if (query.toLowerCase().includes(hit.anchor.toLowerCase())) continue;

    usedAnchors.add(hit.anchor);
    selected.push(hit);
  }

  return appendAnchors(
    query,
    selected.map(({ phrase, anchor }) => ({ phrase, anchor })),
    options?.maxLength,
  );
}

function appendAnchors(
  query: string,
  replacements: RelativeDateReplacement[],
  maxLength = Number.POSITIVE_INFINITY,
): { searchQuery: string; replacements: RelativeDateReplacement[] } {
  // The search endpoint rejects an over-long query, so an anchor that would
  // push it past the limit is dropped rather than turning a search into a
  // failed request. No anchor left over means the query goes out untouched.
  const appended: RelativeDateReplacement[] = [];
  let searchQuery = query.trimEnd();
  for (const replacement of replacements) {
    const candidate = `${searchQuery} ${replacement.anchor}`;
    if (candidate.length > maxLength) break;
    searchQuery = candidate;
    appended.push(replacement);
  }
  if (appended.length === 0) return { searchQuery: query, replacements: [] };

  return { searchQuery, replacements: appended };
}

const YEAR = "(?<!\\d)(?:19|20)\\d{2}(?!\\d)";

/**
 * A year a model writes into a query, alone, as a range or a season, after a
 * month name, or glued to Chinese text: "2023", "2023-2025", "2024-25",
 * "November 2026", "2026年11月".
 */
const WRITTEN_DATE = new RegExp(
  `(?:\\b(?:${MONTH_NAMES.join("|")})\\s+)?${YEAR}(?:\\s*[-–/]\\s*${YEAR}|[-–/]\\d{2}(?!\\d))?(?:年(?:\\d{1,2}月)?)?`,
  "gi",
);

/**
 * Anchors the relative dates of the question the user typed onto the query a
 * model wrote for it. The model often replaces "last year" with a year of its
 * own, and a wrong one ("2026" on 2026-11-19), which leaves nothing for the
 * anchor to resolve. So when the question (the last of `userMessages`) has a
 * relative date, the years the model wrote are dropped, and the question's
 * anchors are appended. A year the user typed in any message is kept, since
 * it can be part of a name ("Cyberpunk 2077", "RTX 2080").
 */
export function normalizeFollowUpDates(
  query: string,
  userMessages: readonly string[],
  asOfDate: Date,
  options?: { maxLength?: number },
): { searchQuery: string; replacements: RelativeDateReplacement[] } {
  const question = userMessages.at(-1) ?? "";
  const { replacements } = normalizeRelativeDates(question, asOfDate);
  if (replacements.length === 0)
    return normalizeRelativeDates(query, asOfDate, options);

  const typedYears = userMessages.join("\n").match(new RegExp(YEAR, "g")) ?? [];
  const queryWithoutModelDates = query
    .replace(WRITTEN_DATE, (date) =>
      typedYears.some((year) => date.includes(year)) ? date : "",
    )
    .replace(/\s+/g, " ")
    .trim();

  return appendAnchors(
    queryWithoutModelDates,
    replacements,
    options?.maxLength,
  );
}
