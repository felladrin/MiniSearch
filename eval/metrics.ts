/**
 * Retrieval quality metrics for the offline eval. Pure functions, no I/O, so
 * they are unit-testable without loading the reranker model.
 *
 * Relevance is binary: a url is either in the ground-truth relevant set or it
 * is not. This matches how the golden set is labeled and keeps the metrics
 * stable enough to act as a regression signal.
 */

/**
 * Discounted Cumulative Gain at rank k for a ranked, 0/1 relevance list.
 *
 * `gains` is in ranked order (index 0 is rank 1). Positions are discounted
 * with log2(rank + 1), the standard IR discounting.
 */
export function dcgAtK(gains: number[], k: number): number {
  return gains
    .slice(0, k)
    .reduce((sum, gain, i) => sum + gain / Math.log2(i + 2), 0);
}

/**
 * Normalized DCG at rank k for binary relevance.
 *
 * `rankedUrls` is the ranked output under test; `relevantUrls` is the
 * ground-truth set of relevant urls. Returns a value in [0, 1]: 1 when every
 * relevant url that fits in the top-k is placed there, 0 when none are.
 *
 * The ideal ranking places as many relevant urls as possible at the very top
 * (capped at k), so a result set with more relevant urls than k is scored
 * against an ideal top-k that is entirely relevant.
 */
export function ndcgAtK(
  rankedUrls: string[],
  relevantUrls: Iterable<string>,
  k: number,
): number {
  const relevant = new Set(relevantUrls);
  if (relevant.size === 0 || k <= 0) return 0;

  // Count each url at most once: a duplicate listing of the same url must not
  // earn gain twice, or nDCG could exceed 1. The first occurrence keeps the
  // url's rank; later duplicates are ignored.
  const seen = new Set<string>();
  const gains = rankedUrls.map((url) => {
    if (seen.has(url)) return 0;
    seen.add(url);
    return relevant.has(url) ? 1 : 0;
  });
  const actualDcg = dcgAtK(gains, k);

  const idealRelevant = Math.min(k, relevant.size);
  const idealDcg = dcgAtK(
    Array.from({ length: idealRelevant }, () => 1),
    k,
  );

  return idealDcg === 0 ? 0 : actualDcg / idealDcg;
}

/**
 * Recall at rank k for binary relevance: the fraction of the relevant urls
 * that appear in the top-k of `rankedUrls`.
 *
 * This is the metric that catches the reranker's score filter dropping a
 * relevant result: a relevant url removed from the ranked output can never be
 * recalled.
 */
export function recallAtK(
  rankedUrls: string[],
  relevantUrls: Iterable<string>,
  k: number,
): number {
  const relevant = new Set(relevantUrls);
  if (relevant.size === 0 || k <= 0) return 0;

  const foundInTopK = new Set(
    rankedUrls.slice(0, k).filter((url) => relevant.has(url)),
  );

  return foundInTopK.size / relevant.size;
}
