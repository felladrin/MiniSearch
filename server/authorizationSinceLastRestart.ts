/**
 * Aggregate counters for the requests that reached token verification.
 *
 * The rate limiter keys on the client IP, so that is the one thing these must
 * not keep: no address, no token, no query, and no timestamp per request. What
 * is left says whether the instance is being abused, whether a client is
 * broken, and how the shared request budget is spent across the endpoints that
 * share it, none of which needs to know who asked.
 */

import { getRejectedTokenCacheHits } from "./rejectedTokens.ts";
import {
  RATE_LIMIT_DURATION_SECONDS,
  RATE_LIMIT_POINTS,
  type RejectionReason,
  THUMBNAIL_RATE_LIMIT_DURATION_SECONDS,
  THUMBNAIL_RATE_LIMIT_POINTS,
} from "./verifyTokenAndRateLimit.ts";

/**
 * Which endpoint family a request was aimed at. `other` is what keeps the
 * totals closed when a new endpoint starts using the same verification funnel
 * and nobody extends this list.
 */
export type AuthorizationSurface =
  | "search"
  | "pageContent"
  | "thumbnail"
  | "inference"
  | "other";

interface SurfaceCounts {
  authorized: number;
  rejected: number;
}

let authorized = 0;

const reasons: Record<RejectionReason, number> = {
  rateLimited: 0,
  missingToken: 0,
  invalidToken: 0,
};

const bySurface: Record<AuthorizationSurface, SurfaceCounts> = {
  search: { authorized: 0, rejected: 0 },
  pageContent: { authorized: 0, rejected: 0 },
  thumbnail: { authorized: 0, rejected: 0 },
  inference: { authorized: 0, rejected: 0 },
  other: { authorized: 0, rejected: 0 },
};

export function recordAuthorizedRequest(surface: AuthorizationSurface): void {
  authorized++;
  bySurface[surface].authorized++;
}

export function recordRejectedRequest(
  surface: AuthorizationSurface,
  reason: RejectionReason,
): void {
  reasons[reason]++;
  bySurface[surface].rejected++;
}

/**
 * `authorized` plus every entry of `reasons` sums to `requests`, and each half
 * of `bySurface` sums to its side of that, so a request that goes uncounted
 * shows up as a gap rather than being lost silently.
 *
 * The limiter's own settings ride along because the counts cannot be read
 * without them: 40 rate-limited requests means something different at 10
 * points per 10 seconds than it would at 100.
 */
export function getAuthorizationStats() {
  const rejected = Object.values(reasons).reduce(
    (total, count) => total + count,
    0,
  );
  const requests = authorized + rejected;

  return {
    requests,
    authorized,
    rejectedRate: Number(((rejected / requests) * 100 || 0).toFixed(1)),
    rejectedTokenCacheHits: getRejectedTokenCacheHits(),
    reasons: { ...reasons },
    // Deep copy, so a caller holding a snapshot for comparison does not watch
    // it change under them as later requests arrive.
    bySurface: Object.fromEntries(
      Object.entries(bySurface).map(([surface, counts]) => [
        surface,
        { ...counts },
      ]),
    ) as Record<AuthorizationSurface, SurfaceCounts>,
    limiter: {
      points: RATE_LIMIT_POINTS,
      durationSeconds: RATE_LIMIT_DURATION_SECONDS,
      thumbnail: {
        points: THUMBNAIL_RATE_LIMIT_POINTS,
        durationSeconds: THUMBNAIL_RATE_LIMIT_DURATION_SECONDS,
      },
    },
  };
}
