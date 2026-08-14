/**
 * Counter for textual searches since server restart
 */
let textualSearchesSinceLastRestart = 0;
/**
 * Counter for graphical searches since server restart
 */
let graphicalSearchesSinceLastRestart = 0;

/**
 * Gets the number of textual searches since last restart
 * @returns Number of textual searches
 */
export function getTextualSearchesSinceLastRestart() {
  return textualSearchesSinceLastRestart;
}

/**
 * Increments the textual search counter
 */
export function incrementTextualSearchesSinceLastRestart() {
  textualSearchesSinceLastRestart++;
}

/**
 * Gets the number of graphical searches since last restart
 * @returns Number of graphical searches
 */
export function getGraphicalSearchesSinceLastRestart() {
  return graphicalSearchesSinceLastRestart;
}

/**
 * Increments the graphical search counter
 */
export function incrementGraphicalSearchesSinceLastRestart() {
  graphicalSearchesSinceLastRestart++;
}

// The two counters below stand in for the per-search log lines that used to
// carry the query text: how often either case happens is what anyone acts on,
// and that survives without recording what was searched for.

/**
 * Counter for searches SearXNG answered with zero results
 */
let searchesWithoutResultsSinceLastRestart = 0;
/**
 * Counter for searches whose results were all dropped during processing
 */
let searchesWithAllResultsDiscardedSinceLastRestart = 0;

/**
 * Gets the number of searches SearXNG answered with zero results
 * @returns Number of empty searches
 */
export function getSearchesWithoutResultsSinceLastRestart() {
  return searchesWithoutResultsSinceLastRestart;
}

/**
 * Increments the empty-search counter
 */
export function incrementSearchesWithoutResultsSinceLastRestart() {
  searchesWithoutResultsSinceLastRestart++;
}

/**
 * Gets the number of searches whose results were all dropped during processing
 * @returns Number of fully discarded searches
 */
export function getSearchesWithAllResultsDiscardedSinceLastRestart() {
  return searchesWithAllResultsDiscardedSinceLastRestart;
}

/**
 * Increments the fully-discarded-search counter
 */
export function incrementSearchesWithAllResultsDiscardedSinceLastRestart() {
  searchesWithAllResultsDiscardedSinceLastRestart++;
}
