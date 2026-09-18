/**
 * Aggregate counters for the reranking stage.
 *
 * The reranker sees the query and every snippet, and none of that is kept: how
 * many results came in, how many survived the score filter, how long the model
 * took, and how often it was unavailable. Those are the numbers the filter's
 * two thresholds should be moved against, and today they have none.
 */

import type { SearchType } from "./searchesSinceLastRestart.ts";

interface RerankCounts {
  reranks: number;
  totalMs: number;
  considered: number;
  kept: number;
}

const byType: Record<SearchType, RerankCounts> = {
  text: { reranks: 0, totalMs: 0, considered: 0, kept: 0 },
  images: { reranks: 0, totalMs: 0, considered: 0, kept: 0 },
};
let fallbackApplied = 0;
let skippedUnhealthy = 0;
let failed = 0;

export function recordRerank(
  searchType: SearchType,
  {
    considered,
    kept,
    durationMs,
    usedPercentageFallback,
  }: {
    considered: number;
    kept: number;
    durationMs: number;
    usedPercentageFallback: boolean;
  },
): void {
  const counts = byType[searchType];
  counts.reranks++;
  counts.totalMs += durationMs;
  counts.considered += considered;
  counts.kept += kept;
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
function summarize({ reranks, totalMs, considered, kept }: RerankCounts) {
  return {
    reranks,
    averageMs: Math.round(totalMs / reranks || 0),
    considered,
    kept,
    keptRate: Number(((kept / considered) * 100 || 0).toFixed(1)),
  };
}

export function getRerankingStats() {
  const totals = Object.values(byType).reduce(
    (total, counts) => ({
      reranks: total.reranks + counts.reranks,
      totalMs: total.totalMs + counts.totalMs,
      considered: total.considered + counts.considered,
      kept: total.kept + counts.kept,
    }),
    { reranks: 0, totalMs: 0, considered: 0, kept: 0 },
  );
  return {
    ...summarize(totals),
    fallbackApplied,
    skippedUnhealthy,
    failed,
    byType: {
      text: summarize(byType.text),
      images: summarize(byType.images),
    },
  };
}
