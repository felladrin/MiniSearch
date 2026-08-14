/**
 * How a single page read ended. Everything other than `read` means the page
 * contributed nothing to the prompt and its result kept only its snippet.
 */
export type PageReadOutcome =
  | "read"
  | "blocked"
  | "notADocument"
  | "httpError"
  | "redirectLimit"
  | "timedOut"
  | "tooLittleText"
  | "failed";

/**
 * Aggregate counters for the pages read since the server started.
 *
 * Deliberately counts and nothing else. The obvious thing to log while reading
 * pages is the query and the URL, and that is exactly the pair that says what
 * a user searched for, so none of it is recorded: no query, no URL, no host, no
 * timestamp per read. What is left still answers the questions worth asking of
 * this feature, because every counter below is attached to a constant someone
 * will want to move.
 */
const outcomes: Record<PageReadOutcome, number> = {
  read: 0,
  blocked: 0,
  notADocument: 0,
  httpError: 0,
  redirectLimit: 0,
  timedOut: 0,
  tooLittleText: 0,
  failed: 0,
};

let totalReadMs = 0;
let bodiesTruncated = 0;
let totalPassagesKept = 0;
let totalPassagesAvailable = 0;

/**
 * Records one finished page read.
 *
 * @param outcome - How the read ended
 * @param durationMs - Wall time spent on it, including redirects
 * @param bodyTruncated - Whether the response hit the byte cap, which tunes `MAX_RESPONSE_BYTES`
 * @param passagesKept - Passages that fit the character budget, which tunes `MAX_PAGE_CHARS`
 * @param passagesAvailable - Passages the page offered
 */
export function recordPageRead({
  outcome,
  durationMs,
  bodyTruncated = false,
  passagesKept = 0,
  passagesAvailable = 0,
}: {
  outcome: PageReadOutcome;
  durationMs: number;
  bodyTruncated?: boolean;
  passagesKept?: number;
  passagesAvailable?: number;
}): void {
  outcomes[outcome]++;
  totalReadMs += durationMs;
  if (bodyTruncated) bodiesTruncated++;
  totalPassagesKept += passagesKept;
  totalPassagesAvailable += passagesAvailable;
}

/**
 * Reports the page-reading counters for the status endpoint.
 *
 * @returns Totals since the last restart, with `read` plus every `skipped`
 * entry summing to `requested`
 */
export function getPageReadStats() {
  const { read, ...skipped } = outcomes;
  const requested = Object.values(outcomes).reduce(
    (total, count) => total + count,
    0,
  );

  return {
    requested,
    read,
    readRate: Number(((read / requested) * 100 || 0).toFixed(1)),
    averageReadMs: Math.round(totalReadMs / requested || 0),
    bodiesTruncated,
    // A ratio rather than a count of pages that overflowed: an article almost
    // always has more passages than the budget takes, so counting the pages
    // that overflowed reads ~100% whatever the budget is set to and settles
    // nothing. How much of a page survives moves when the budget moves.
    excerptKeptRate: Number(
      ((totalPassagesKept / totalPassagesAvailable) * 100 || 0).toFixed(1),
    ),
    skipped,
  };
}
