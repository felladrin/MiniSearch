/**
 * Aggregate counters for the reranking stage.
 *
 * The reranker sees the query and every snippet, and none of that is kept: how
 * many results came in, how many survived the score filter, how long the model
 * took, and how often it was unavailable. Those are the numbers the filter's
 * two thresholds should be moved against, and today they have none.
 */

let reranks = 0;
let totalMs = 0;
let totalConsidered = 0;
let totalKept = 0;
let fallbackApplied = 0;
let skippedUnhealthy = 0;
let failed = 0;

export function recordRerank({
  considered,
  kept,
  durationMs,
  usedPercentageFallback,
}: {
  considered: number;
  kept: number;
  durationMs: number;
  usedPercentageFallback: boolean;
}): void {
  reranks++;
  totalMs += durationMs;
  totalConsidered += considered;
  totalKept += kept;
  if (usedPercentageFallback) fallbackApplied++;
}

/** The model was not loaded, so the endpoint served SearXNG's own order. */
export function recordRerankSkipped(): void {
  skippedUnhealthy++;
}

/** The model was loaded and reranking threw anyway. */
export function recordRerankFailed(): void {
  failed++;
}

/**
 * `keptRate` is a share rather than a count for the same reason
 * `pageReads.excerptKeptRate` is: a count of searches whose results were
 * filtered reads ~100% whatever the threshold is, and settles nothing.
 */
export function getRerankingStats() {
  return {
    reranks,
    averageMs: Math.round(totalMs / reranks || 0),
    keptRate: Number(((totalKept / totalConsidered) * 100 || 0).toFixed(1)),
    fallbackApplied,
    skippedUnhealthy,
    failed,
  };
}
