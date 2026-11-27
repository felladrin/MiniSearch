/**
 * The rate limiter keys on the client IP, so that is the one thing these must
 * not keep: no address, no token, no query, and no timestamp per request. What
 * is left says whether the instance is being abused, whether a client is
 * broken, and how the shared request budget is spent across the endpoints that
 * share it, none of which needs to know who asked.
 *
 * A rejected request does carry one thing worth publishing, its `User-Agent`,
 * and it goes out the same way an engine's free-form failure goes out as
 * `blocked`, `timeout` or `other`: sorted into a fixed vocabulary first, so the
 * answer to "does this look like a stale browser tab or a script" is public and
 * the client's own string is not. What a client claims to be is all the label
 * can say: a script is free to send a browser string, and only a crawler that
 * announces itself is caught as one.
 */

import {
  getRejectedTokenCacheHits,
  getRejectedTokenCount,
} from "./rejectedTokens.ts";
import {
  RATE_LIMIT_DURATION_SECONDS,
  RATE_LIMIT_POINTS,
  type RejectionReason,
  THUMBNAIL_RATE_LIMIT_DURATION_SECONDS,
  THUMBNAIL_RATE_LIMIT_POINTS,
} from "./verifyTokenAndRateLimit.ts";

/**
 * `other` is what keeps the totals closed when a new endpoint starts using the
 * same verification funnel and nobody extends this list.
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

/**
 * What a rejected request's client looks like. `other` is where a string that
 * matches nothing lands, including no string at all, so the counts stay closed.
 */
export type RejectedClientKind =
  | "bot"
  | "curl"
  | "wget"
  | "python"
  | "node"
  | "java"
  | "go"
  | "browser"
  | "other";

/**
 * Checked in order, first match wins. A bot comes first because a crawler is
 * free to present a browser string, and catching the ones that announce
 * themselves is the useful half. `browser` is a loose fit on purpose: it says a
 * browser-shaped client asked, not which one, and not that it really is one.
 */
const CLIENT_PATTERNS: [RejectedClientKind, RegExp][] = [
  [
    "bot",
    /bot|crawler|spider|crawl|headless|lighthouse|scrapy|facebookexternalhit/i,
  ],
  ["curl", /curl\//i],
  ["wget", /wget\//i],
  ["python", /python/i],
  ["node", /\bnode\b|node-fetch|undici|axios/i],
  ["java", /\bjava[/-]|okhttp|apache-httpclient|jakarta\.commons/i],
  ["go", /go-http-client/i],
  ["browser", /mozilla\/[45]\.0/i],
];

let authorized = 0;

const reasons: Record<RejectionReason, number> = {
  rateLimited: 0,
  missingToken: 0,
  invalidToken: 0,
};

const rejectedByClient: Record<RejectedClientKind, number> = {
  bot: 0,
  curl: 0,
  wget: 0,
  python: 0,
  node: 0,
  java: 0,
  go: 0,
  browser: 0,
  other: 0,
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

/** Sorts a client's own string into the published vocabulary. */
export function classifyRejectedClient(
  userAgent: string | undefined,
): RejectedClientKind {
  const value = userAgent ?? "";
  for (const [kind, pattern] of CLIENT_PATTERNS) {
    if (pattern.test(value)) return kind;
  }

  return "other";
}

export function recordRejectedRequest(
  surface: AuthorizationSurface,
  reason: RejectionReason,
  userAgent?: string,
): void {
  reasons[reason]++;
  bySurface[surface].rejected++;

  // A request the limiter stopped is not a refused client: the limiter runs
  // before the token check, so it can be somebody holding a real token who
  // went over budget. Counting them would put an authorized visitor's software
  // on a public page.
  if (reason !== "rateLimited") {
    rejectedByClient[classifyRejectedClient(userAgent)]++;
  }
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
    distinctRejectedTokens: getRejectedTokenCount(),
    reasons: { ...reasons },
    // Copy, for the same reason as `reasons`: a snapshot must not move later.
    // Sums to `missingToken` plus `invalidToken`, not to every rejection.
    rejectedByClient: { ...rejectedByClient },
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
