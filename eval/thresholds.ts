/**
 * The retrieval eval's thresholds, shared by the integration test (which
 * asserts the working reranker clears the floors) and goldenSet.test.ts (which
 * asserts the no-op baseline stays below the ceilings). Keeping them in one
 * place means the ceiling-below-floor relation is checked, not just commented:
 * if a floor were lowered to or below its ceiling, the premise inverts and a
 * dead reranker would pass.
 */

/** The rank at which nDCG / recall are measured. */
export const K = 3;

/**
 * Floors the working reranker must clear. Set in the middle of the band
 * between a working reranker (0.950 / 0.981) and a no-op reranker (0.587 /
 * 0.500), with headroom on both sides for cross-CPU score drift.
 */
export const MIN_MEAN_NDCG = 0.75;
export const MIN_MEAN_RECALL = 0.7;

/**
 * Ceilings the no-op (identity) baseline must stay below. These sit below the
 * floors above; the gap is what makes the floors falsifiable.
 */
export const MAX_NOOP_MEAN_NDCG = 0.65;
export const MAX_NOOP_MEAN_RECALL = 0.6;
