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

/** A date as a query writes it; `month` is 1 to 12 when the query names one. */
interface WrittenDate {
  year: number;
  month?: number;
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

/** Keyboards type any of these: ' U+2018 U+2019 U+02BC U+FF07. */
const APOSTROPHES = "'\u2018\u2019\u02bc\uff07";

/**
 * Whitespace of any kind matches a space and any apostrophe variant matches
 * `'`. The pattern runs on the original text rather than a lowercased copy, so
 * a match keeps its position: "İ".toLowerCase() is two code units.
 */
function compilePhrase(phrase: string, wordBounded: boolean): RegExp {
  const body = phrase
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "\\s+")
    .replace(/'/g, `[${APOSTROPHES}]`);

  return new RegExp(
    wordBounded ? `(?<![A-Za-z])${body}(?![A-Za-z])` : body,
    "gi",
  );
}

const COMPILED_RULES = RULES.map((rule) => ({
  rule,
  pattern: compilePhrase(rule.phrase, rule.wordBounded),
}));

const BLACKLIST_PATTERNS = BLACKLIST_PHRASES.map((phrase) =>
  compilePhrase(phrase, false),
);

function findOccurrences(text: string, pattern: RegExp): Occurrence[] {
  return [...text.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
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
    searchQuery: clampToMaxLength(query, options?.maxLength),
    replacements: [] as RelativeDateReplacement[],
  };

  if (query.trim() === "") return unchanged;

  const blacklistRanges = BLACKLIST_PATTERNS.flatMap((pattern) =>
    findOccurrences(query, pattern),
  );

  const hits: Hit[] = [];
  for (const { rule, pattern } of COMPILED_RULES) {
    for (const occurrence of findOccurrences(query, pattern)) {
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

  const writtenInQuery = writtenDates(query);

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
    // the query. Compared as dates, so "Dec 2026" meets December 2026 and the
    // "2026" inside "120265" meets nothing.
    if (isAlreadyWritten(writtenInQuery, hit.anchor)) continue;

    usedAnchors.add(hit.anchor);
    selected.push(hit);
  }

  return appendAnchors(
    query,
    selected.map(({ phrase, anchor }) => ({ phrase, anchor })),
    options?.maxLength,
  );
}

/**
 * The query cut to `maxLength` characters, so the result never exceeds the
 * limit the search endpoint enforces. A query within the limit is returned
 * as is.
 */
function clampToMaxLength(query: string, maxLength?: number): string {
  if (maxLength === undefined || query.length <= maxLength) return query;
  return query.slice(0, maxLength).trimEnd();
}

function appendAnchors(
  query: string,
  replacements: RelativeDateReplacement[],
  maxLength = Number.POSITIVE_INFINITY,
): { searchQuery: string; replacements: RelativeDateReplacement[] } {
  // The search endpoint rejects an over-long query, so the query itself is cut
  // to the limit, and an anchor that would push it past the limit is dropped
  // rather than turning a search into a failed request. No anchor left over
  // means the query goes out as it came, cut only when it was too long.
  const base = clampToMaxLength(query, maxLength);
  const appended: RelativeDateReplacement[] = [];
  // Both ends, so a query that is only a written date gets no leading space,
  // which would give the same search a second cache key.
  let searchQuery = base.trim();
  for (const replacement of replacements) {
    const candidate = searchQuery
      ? `${searchQuery} ${replacement.anchor}`
      : replacement.anchor;
    if (candidate.length > maxLength) break;
    searchQuery = candidate;
    appended.push(replacement);
  }
  if (appended.length === 0) return { searchQuery: base, replacements: [] };

  return { searchQuery, replacements: appended };
}

const YEAR = "(?<!\\d)(?:19|20)\\d{2}(?!\\d)";

/** A month name or its three-letter abbreviation ("Sept" too), as a whole word. */
const MONTH_WORD = `(?:${MONTH_NAMES.flatMap((name) => [name, name.slice(0, 3)]).join("|")}|Sept)\\b`;

/**
 * A year a model writes into a query, alone, as a range or a season, after a
 * month name (written out or abbreviated), or glued to Chinese text: "2023",
 * "2023-2025", "2024-25", "November 2026", "Dec 2026", "2026年11月",
 * "2025 年 3 月".
 */
const WRITTEN_DATE = new RegExp(
  `(?:\\b${MONTH_WORD}\\.?\\s+)?${YEAR}(?:\\s*[-–/]\\s*${YEAR}|[-–/]\\d{2}(?!\\d))?(?:\\s*年(?:\\s*\\d{1,2}\\s*月)?)?`,
  "gi",
);

function monthNumber(word: string): number {
  const prefix = word.slice(0, 3).toLowerCase();
  return (
    MONTH_NAMES.findIndex((name) => name.slice(0, 3).toLowerCase() === prefix) +
    1
  );
}

/**
 * A month written inside the date wins ("2026年12月", "2026-12", which is a
 * season rather than a month when it reads "2024-25"), then a name in front of
 * the year, then one behind it, unless the next date starts with that name. A
 * range takes a month only from a name in front, and only for its first year.
 */
function monthOfWrittenDate(
  match: RegExpExecArray,
  nextMatch: RegExpExecArray | undefined,
  text: string,
  yearCount: number,
): number | undefined {
  const written = match[0];

  if (yearCount === 1) {
    const chinese = written.match(/年\s*(\d{1,2})\s*月/);
    if (chinese) return Number(chinese[1]);

    const iso = written.match(/(?:19|20)(\d{2})[-/](\d{2})(?!\d)/);
    if (iso) {
      const [yearDigits, month] = [Number(iso[1]), Number(iso[2])];
      const isSeason = month === (yearDigits + 1) % 100;
      if (!isSeason && month >= 1 && month <= 12) return month;
    }
  }

  const leading = written.match(new RegExp(`^${MONTH_WORD}`, "i"));
  if (leading) return monthNumber(leading[0]);

  if (yearCount !== 1) return undefined;

  const end = match.index + written.length;
  const trailing = text
    .slice(end)
    .match(new RegExp(`^[,\\s]+(${MONTH_WORD})`, "i"));
  if (!trailing) return undefined;

  const wordStart = end + trailing[0].length - trailing[1].length;
  return nextMatch?.index === wordStart ? undefined : monthNumber(trailing[1]);
}

function writtenDates(text: string): WrittenDate[] {
  const matches = [...text.matchAll(WRITTEN_DATE)];

  return matches.flatMap((match, index) => {
    const years = (match[0].match(new RegExp(YEAR, "g")) ?? []).map(Number);
    const month = monthOfWrittenDate(
      match,
      matches[index + 1],
      text,
      years.length,
    );

    return years.map((year, position) => ({
      year,
      month: position === 0 ? month : undefined,
    }));
  });
}

/** A year-only anchor is met by any written date in that year. */
function isAlreadyWritten(
  written: readonly WrittenDate[],
  anchor: string,
): boolean {
  const [wanted] = writtenDates(anchor);
  if (!wanted) return false;

  return written.some(
    (date) =>
      date.year === wanted.year &&
      (wanted.month === undefined || date.month === wanted.month),
  );
}

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

  // A date the user typed survives the cleaning above, and its anchor would
  // repeat it.
  const writtenInQuery = writtenDates(queryWithoutModelDates);

  return appendAnchors(
    queryWithoutModelDates,
    replacements.filter(
      ({ anchor }) => !isAlreadyWritten(writtenInQuery, anchor),
    ),
    options?.maxLength,
  );
}
