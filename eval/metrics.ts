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

/**
 * Rank-Biased Overlap between two ranked url lists (Webber et al., WWW 2010,
 * WDDM-1.1 definition).
 *
 * `a` and `b` are ranked urls (index 0 is rank 1). Returns the overlap of the
 * two top-k prefixes with exponential discounting on rank: agreement at the
 * top is weighted far more heavily than agreement deep in the list. A value
 * in [0, 1]: 1 when both lists are identical, 0 when they share no urls.
 *
 * k = max(|a|, |b|). The WDDM-1.1 formula adds the tail extrapolation term
 * `p^k * |A_k ∩ B_k| / k` on top of the truncated sum; without it, two
 * identical finite lists would score 1 - p^k instead of 1, so the truncated
 * sum alone must not be used here.
 *
 * The intersection is set-based over first-occurrence ranks, so a url
 * duplicated in a list is counted once, matching the other metrics in this
 * file.
 *
 * `p` must be in [0, 1): at p = 1 the (1 - p) discount factor vanishes and
 * the formula degenerates to a single-position intersection, so it is
 * rejected rather than silently mis-scored. p = 0 is valid and scores only
 * rank 1 (the (1 - p) sum keeps only d = 1 and the tail term is 0).
 */
export function rbo(a: string[], b: string[], p: number): number {
  if (p < 0 || p >= 1) {
    throw new RangeError(`rbo: p must be in [0, 1), got ${p}`);
  }

  const k = Math.max(a.length, b.length);
  if (k === 0) return 0;

  // First-occurrence rank per url (rank 1 for index 0). A duplicated url
  // keeps its earliest rank, so it can enter a prefix intersection at most
  // once; a url not in a list has no rank there and never intersects.
  const firstRankA = new Map<string, number>();
  a.forEach((url, i) => {
    if (!firstRankA.has(url)) firstRankA.set(url, i + 1);
  });
  const firstRankB = new Map<string, number>();
  b.forEach((url, i) => {
    if (!firstRankB.has(url)) firstRankB.set(url, i + 1);
  });

  let score = 0;
  let weight = 1; // p^(d-1), folded into the loop to avoid re-exponentiating
  for (let d = 1; d <= k; d++) {
    // |A_d ∩ B_d|: urls ranked at or before d in both lists.
    let intersection = 0;
    for (const [url, rank] of firstRankA) {
      const otherRank = firstRankB.get(url);
      if (otherRank !== undefined && rank <= d && otherRank <= d) {
        intersection++;
      }
    }
    score += (weight * intersection) / d;
    weight *= p;
  }
  // Tail extrapolation: the expected overlap of the two infinite lists past
  // rank k, assuming the last observed common prefix repeats. Since k is at
  // least both list lengths, this is just the size of the url intersection.
  let lastRankCommon = 0;
  for (const [url, rank] of firstRankA) {
    const otherRank = firstRankB.get(url);
    if (otherRank !== undefined && rank <= k && otherRank <= k) {
      lastRankCommon++;
    }
  }
  return (1 - p) * score + p ** k * (lastRankCommon / k);
}
