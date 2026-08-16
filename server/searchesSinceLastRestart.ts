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

// The two counters below stand in for the per-search log lines that used to
// carry the query text: how often either case happens is what anyone acts on,
// and that survives without recording what was searched for.

let searchesWithoutResultsSinceLastRestart = 0;
let searchesWithAllResultsDiscardedSinceLastRestart = 0;

export function getSearchesWithoutResultsSinceLastRestart() {
  return searchesWithoutResultsSinceLastRestart;
}

export function incrementSearchesWithoutResultsSinceLastRestart() {
  searchesWithoutResultsSinceLastRestart++;
}

export function getSearchesWithAllResultsDiscardedSinceLastRestart() {
  return searchesWithAllResultsDiscardedSinceLastRestart;
}

export function incrementSearchesWithAllResultsDiscardedSinceLastRestart() {
  searchesWithAllResultsDiscardedSinceLastRestart++;
}
