import {
  RATE_LIMIT_DURATION_SECONDS,
  RATE_LIMIT_POINTS,
  type RejectionReason,
} from "./verifyTokenAndRateLimit.ts";

/**
 * Which endpoint family a request was aimed at. `other` is what keeps the
 * totals closed when a new endpoint starts using the same verification funnel
 * and nobody extends this list.
 */
export type AuthorizationSurface =
  | "search"
  | "pageContent"
  | "inference"
  | "other";

/**
 * Aggregate counters for the requests that reached token verification.
 *
 * The rate limiter keys on the client IP, so that is the one thing this must
 * not keep: no address, no token, no query, and no timestamp per request. What
 * is left says whether the instance is being abused, whether a client is
 * broken, and which surface spends the shared request budget, none of which
 * needs to know who asked.
 */
let authorized = 0;

const reasons: Record<RejectionReason, number> = {
  rateLimited: 0,
  missingToken: 0,
  invalidToken: 0,
};

const bySurface: Record<AuthorizationSurface, number> = {
  search: 0,
  pageContent: 0,
  inference: 0,
  other: 0,
};

export function recordAuthorizedRequest(): void {
  authorized++;
}

export function recordRejectedRequest(
  surface: AuthorizationSurface,
  reason: RejectionReason,
): void {
  reasons[reason]++;
  bySurface[surface]++;
}

/**
 * `authorized` plus every entry of `reasons` sums to `requests`, and
 * `bySurface` sums to the same rejection total, so a request that goes
 * uncounted shows up as a gap rather than being lost silently.
 *
 * The limiter's own settings ride along because the counts cannot be read
 * without them: 40 rate-limited requests means something different at 10
 * points per 10 seconds than it would at 100.
 */
export function getRequestAuthorizationStats() {
  const rejected = Object.values(reasons).reduce(
    (total, count) => total + count,
    0,
  );
  const requests = authorized + rejected;

  return {
    requests,
    authorized,
    rejectedRate: Number(((rejected / requests) * 100 || 0).toFixed(1)),
    // Copies, so a caller holding a snapshot for comparison does not watch it
    // change under them as later requests arrive.
    reasons: { ...reasons },
    bySurface: { ...bySurface },
    limiter: {
      points: RATE_LIMIT_POINTS,
      durationSeconds: RATE_LIMIT_DURATION_SECONDS,
    },
  };
}
