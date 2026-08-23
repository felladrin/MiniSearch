/**
 * Tokens that have already failed argon2 verification.
 *
 * A process verifies against one search token for its whole life, so a token
 * that failed once cannot become valid again in this process: the lookup is
 * exact rather than a heuristic. A replay of a dead token then costs a Set
 * check instead of a full argon2id verification, which is what a stream of
 * dead search URLs from earlier deployments used to pay.
 */
const rejectedTokens = new Set<string>();

/**
 * Bounds the set against a flood of distinct junk tokens: once full, the
 * oldest entry is evicted and that token pays for one verification again if
 * it comes back.
 */
export const MAX_REJECTED_TOKENS = 1024;

/**
 * Rejections served from this set without a second argon2 verification, so
 * `/status` can show how much of the dead-token traffic stopped costing a
 * verification.
 */
let rejectedTokenCacheHits = 0;

export function isRejectedToken(token: string) {
  return rejectedTokens.has(token);
}

export function addRejectedToken(token: string) {
  if (rejectedTokens.has(token)) return;
  if (rejectedTokens.size >= MAX_REJECTED_TOKENS) {
    const oldest = rejectedTokens.values().next().value;
    if (oldest !== undefined) rejectedTokens.delete(oldest);
  }
  rejectedTokens.add(token);
}

export function recordRejectedTokenCacheHit(): void {
  rejectedTokenCacheHits++;
}

export function getRejectedTokenCacheHits(): number {
  return rejectedTokenCacheHits;
}
