/** The two engine pools SearXNG is asked for, which fail independently. */
export type SearchType = "text" | "images";

let textualSearchesSinceLastRestart = 0;
let graphicalSearchesSinceLastRestart = 0;

/** Textual searches since the last restart; the counter stands in for a log line and the query is never recorded. */
export function getTextualSearchesSinceLastRestart() {
  return textualSearchesSinceLastRestart;
}

export function incrementTextualSearchesSinceLastRestart() {
  textualSearchesSinceLastRestart++;
}

export function getGraphicalSearchesSinceLastRestart() {
  return graphicalSearchesSinceLastRestart;
}

export function incrementGraphicalSearchesSinceLastRestart() {
  graphicalSearchesSinceLastRestart++;
}

// The three counters below stand in for the per-search log lines that used to
// carry the query text: how often each case happens is what anyone acts on, and
// that survives without recording what was searched for.

let searchesWithoutResultsSinceLastRestart = 0;
let searchesWithUnresponsiveEnginesSinceLastRestart = 0;
let searchesWithAllResultsDiscardedSinceLastRestart = 0;

export function getSearchesWithoutResultsSinceLastRestart() {
  return searchesWithoutResultsSinceLastRestart;
}

export function incrementSearchesWithoutResultsSinceLastRestart() {
  searchesWithoutResultsSinceLastRestart++;
}

export function getSearchesWithUnresponsiveEnginesSinceLastRestart() {
  return searchesWithUnresponsiveEnginesSinceLastRestart;
}

export function incrementSearchesWithUnresponsiveEnginesSinceLastRestart() {
  searchesWithUnresponsiveEnginesSinceLastRestart++;
}

export function getSearchesWithAllResultsDiscardedSinceLastRestart() {
  return searchesWithAllResultsDiscardedSinceLastRestart;
}

export function incrementSearchesWithAllResultsDiscardedSinceLastRestart() {
  searchesWithAllResultsDiscardedSinceLastRestart++;
}

/** One engine SearXNG reported as unresponsive, with the reason it gave. */
export interface UnresponsiveEngine {
  engine: string;
  reason: string;
}

/**
 * What an engine failed with, as a closed vocabulary. `/status` is
 * unauthenticated, and SearXNG's reason strings are free-form text from
 * upstream engines, which an engine could build from the request URL and so
 * from the query. Classifying at the boundary keeps the distinction the field
 * is read for, one engine timing out against every engine being blocked,
 * without publishing a string this repo does not control.
 *
 * `blocked` is named for what it is tested for, a CAPTCHA, a rate limit or an
 * access denial, rather than for SearXNG's own "Suspended" wording: SearXNG
 * benches an engine for generic errors too, and those are short enough to
 * recover inside the retry backoff, so they are deliberately not in this class.
 */
export type EngineFailure = "blocked" | "timeout" | "other";

/** Which engines failed, how often, and what the last failure was. */
const unresponsiveEngines = new Map<
  string,
  { failures: number; lastFailure: EngineFailure }
>();

/**
 * The search types whose last search was lost to unresponsive engines. Keyed by
 * type because text and image searches go out to different engine pools: with
 * one shared flag, the image search the client fires after a failed text search
 * cleared the degradation the text engines were still in.
 */
const searchTypesFailingOnEngines = new Set<SearchType>();

export function recordUnresponsiveEngines(
  searchType: SearchType,
  failures: { engine: string; failure: EngineFailure }[],
): void {
  searchTypesFailingOnEngines.add(searchType);

  for (const { engine, failure } of failures) {
    const seen = unresponsiveEngines.get(engine);
    unresponsiveEngines.set(engine, {
      failures: (seen?.failures ?? 0) + 1,
      lastFailure: failure,
    });
  }
}

/**
 * SearXNG answered this search type, so whatever was failing for it is not
 * failing now. Zero results with no engine errors counts as responding: the
 * engines replied. Without this the flag would stay set for the rest of the
 * process after one bad minute, and `/status` would report a degradation that
 * had already passed.
 */
export function recordRespondingEngines(searchType: SearchType): void {
  searchTypesFailingOnEngines.delete(searchType);
}

/** Which pools are unproven, so a `degraded` status is actionable. */
export function getDegradedSearchTypes(): SearchType[] {
  return [...searchTypesFailingOnEngines];
}

/** Copied out, so a caller holding the payload cannot see later counts change. */
export function getUnresponsiveEngineStats() {
  return Object.fromEntries(
    [...unresponsiveEngines].map(([engine, counts]) => [engine, { ...counts }]),
  );
}

// The counters below are the numbers behind the constants in the search path:
// the client's request timeout, the thumbnail timeout and byte cap, and whether
// the pages behind the results contribute anything. Same basis as the rest of
// this file: totals and running sums, never a query and never a URL.

let textualSearchMs = 0;
let graphicalSearchMs = 0;
let thumbnailsRequested = 0;
let thumbnailsDropped = 0;
let thumbnailsBlocked = 0;

/** One SearXNG round trip, retries and backoff included, so it stays comparable with the timeouts it is there to tune. */
export function recordSearchDuration(
  searchType: SearchType,
  durationMs: number,
): void {
  if (searchType === "text") textualSearchMs += durationMs;
  else graphicalSearchMs += durationMs;
}

export function recordThumbnailRequested(): void {
  thumbnailsRequested++;
}

/** Counts every thumbnail that never reached the client, `blocked` ones included. */
export function recordThumbnailDropped(): void {
  thumbnailsDropped++;
}

/**
 * Refused before any request was made: malformed, non-HTTP, unresolvable, or
 * resolving outside public space. The SSRF guard does not distinguish them, so
 * a dead thumbnail host lands here next to a genuine private-address attempt.
 */
export function recordThumbnailBlocked(): void {
  thumbnailsBlocked++;
}

export function getSearchStats() {
  return {
    averageTextualMs: Math.round(
      textualSearchMs / textualSearchesSinceLastRestart || 0,
    ),
    averageGraphicalMs: Math.round(
      graphicalSearchMs / graphicalSearchesSinceLastRestart || 0,
    ),
  };
}

export function getThumbnailStats() {
  return {
    requested: thumbnailsRequested,
    dropped: thumbnailsDropped,
    blocked: thumbnailsBlocked,
  };
}
