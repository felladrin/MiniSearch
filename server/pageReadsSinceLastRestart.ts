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
let excerptsTruncated = 0;

/**
 * Records one finished page read.
 *
 * @param outcome - How the read ended
 * @param durationMs - Wall time spent on it, including redirects
 * @param bodyTruncated - Whether the response hit the byte cap, which tunes `MAX_RESPONSE_BYTES`
 * @param excerptTruncated - Whether the character budget dropped passages the page had, which tunes `MAX_PAGE_CHARS`
 */
export function recordPageRead({
  outcome,
  durationMs,
  bodyTruncated = false,
  excerptTruncated = false,
}: {
  outcome: PageReadOutcome;
  durationMs: number;
  bodyTruncated?: boolean;
  excerptTruncated?: boolean;
}): void {
  outcomes[outcome]++;
  totalReadMs += durationMs;
  if (bodyTruncated) bodiesTruncated++;
  if (excerptTruncated) excerptsTruncated++;
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
    excerptsTruncated,
    skipped,
  };
}
