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

// The counters below are the numbers behind the constants in the search path:
// the client's request timeout, the thumbnail timeout and byte cap, and whether
// the pages behind the results contribute anything. Same basis as the rest of
// this file: totals and running sums, never a query and never a URL.

let textualSearchMs = 0;
let graphicalSearchMs = 0;
let searchesWithGroundingSinceLastRestart = 0;
let searchesWithoutGroundingSinceLastRestart = 0;
let thumbnailsRequested = 0;
let thumbnailsDropped = 0;
let thumbnailsBlocked = 0;

/** One SearXNG round trip, retries and backoff included, so it stays comparable with the timeouts it is there to tune. */
export function recordSearchDuration(
  searchType: "text" | "images",
  durationMs: number,
): void {
  if (searchType === "text") textualSearchMs += durationMs;
  else graphicalSearchMs += durationMs;
}

/**
 * Whether one search got any page content to ground its answer on.
 * `pageReads` counts pages; this counts searches, and a 50% read rate means
 * something different depending on which of the two it came from.
 */
export function recordGroundingOutcome(hadContent: boolean): void {
  if (hadContent) searchesWithGroundingSinceLastRestart++;
  else searchesWithoutGroundingSinceLastRestart++;
}

export function recordThumbnailRequested(): void {
  thumbnailsRequested++;
}

/** Counts every thumbnail that never reached the client, `blocked` ones included. */
export function recordThumbnailDropped(): void {
  thumbnailsDropped++;
}

/** Refused because the host resolved outside public space: a security signal, not a tuning one. */
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
    withGrounding: searchesWithGroundingSinceLastRestart,
    withoutGrounding: searchesWithoutGroundingSinceLastRestart,
  };
}

export function getThumbnailStats() {
  return {
    requested: thumbnailsRequested,
    dropped: thumbnailsDropped,
    blocked: thumbnailsBlocked,
  };
}
