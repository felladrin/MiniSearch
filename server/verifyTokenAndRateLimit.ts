import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import path from "node:path";
import debug from "debug";
import { argon2Verify } from "hash-wasm";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { ARGON2_HASH_PREFIX } from "../shared/argon2Parameters.ts";
import {
  addRejectedToken,
  isRejectedToken,
  recordRejectedTokenCacheHit,
} from "./rejectedTokens.ts";
import { getSearchToken, hasSearchTokenFileChanged } from "./searchToken.ts";
import { addVerifiedToken, isVerifiedToken } from "./verifiedTokens.ts";

const fileName = path.basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

export const RATE_LIMIT_POINTS = 10;
export const RATE_LIMIT_DURATION_SECONDS = 10;

const rateLimiter = new RateLimiterMemory({
  points: RATE_LIMIT_POINTS,
  duration: RATE_LIMIT_DURATION_SECONDS,
});

/**
 * A single image search fans out into up to 30 tile loads, so `/thumbnail`
 * draws from its own budget: sharing the search bucket would let one grid
 * exhaust the user's text-search and page-read budget, and the 429s would
 * land on tiles the browser's `<img>` cannot retry. The token gate stays
 * shared, so a hostile caller still pays one verification per tile.
 */
export const THUMBNAIL_RATE_LIMIT_POINTS = 60;
export const THUMBNAIL_RATE_LIMIT_DURATION_SECONDS = 10;

export const thumbnailRateLimiter = new RateLimiterMemory({
  points: THUMBNAIL_RATE_LIMIT_POINTS,
  duration: THUMBNAIL_RATE_LIMIT_DURATION_SECONDS,
});

/** Why a request was turned away, named by the check that turned it away. */
export type RejectionReason = "rateLimited" | "missingToken" | "invalidToken";

/**
 * A rejection always carries its status, its message and its reason together,
 * so a caller cannot answer 401 without also being able to say what happened.
 */
export type TokenVerificationResult =
  | { isAuthorized: true }
  | {
      isAuthorized: false;
      statusCode: number;
      error: string;
      reason: RejectionReason;
    };

/** Whether to trust proxy-set forwarding headers. Off unless `TRUST_PROXY` is `true`/`1`. */
function isProxyTrusted(): boolean {
  const value = process.env.TRUST_PROXY?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/**
 * Resolves the client IP used as the rate-limit key.
 *
 * `X-Forwarded-For` / `X-Real-IP` are only honored when `TRUST_PROXY` is
 * enabled. On a directly-exposed instance those headers are fully
 * client-controlled, so trusting them would let a caller forge a fresh IP per
 * request and evade rate limiting entirely. When `TRUST_PROXY` is off (the
 * default) we use the real TCP peer address, which cannot be spoofed.
 *
 * Enable `TRUST_PROXY` only when MiniSearch runs behind a reverse proxy that
 * sets the rightmost `X-Forwarded-For` entry (e.g. nginx's
 * `$proxy_add_x_forwarded_for`).
 */
export function getClientIp(request: IncomingMessage): string {
  if (isProxyTrusted()) {
    const forwarded = request.headers["x-forwarded-for"];
    const xff = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
    if (typeof xff === "string" && xff.length > 0) {
      const parts = xff
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const ip = parts[parts.length - 1];
      if (ip && isIP(ip)) {
        return ip;
      }
    }
    const realIp = request.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.length > 0 && isIP(realIp)) {
      return realIp;
    }
  }
  return request.socket.remoteAddress || "unknown";
}

/**
 * Consume one point from the shared rate limiter for a request, keyed by the
 * client IP. Returns `true` when the request is within budget, `false` when the
 * limiter refuses it.
 *
 * It reuses the same limiter instance the search path consumes from, so a
 * caller cannot get a second, independent budget by hitting a different
 * endpoint. Endpoints that pay for expensive work without a token (access-key
 * validation) must consume here before doing that work.
 */
export async function consumeRateLimitPoint(
  request: IncomingMessage,
): Promise<boolean> {
  try {
    await rateLimiter.consume(getClientIp(request));
    return true;
  } catch {
    return false;
  }
}

let hasReportedTokenFileChange = false;

/**
 * Says once, on the way out, why a client holding a real token is being turned
 * away. Without it the only trace is a 401 per request, which reads as a broken
 * search rather than as two processes holding different tokens. The file is
 * only read on a request that is already being rejected, which has just paid
 * for an argon2 verification, so the read costs nothing next to it.
 */
function reportTokenFileChangeOnce() {
  if (hasReportedTokenFileChange || !hasSearchTokenFileChanged()) return;

  hasReportedTokenFileChange = true;
  printMessage(
    "Rejected a token that does not match this server's. The token file was rewritten after startup, so a client that took its token from another process keeps being rejected here until this server restarts.",
  );
}

export async function verifyTokenAndRateLimit(
  token: string | null,
  request?: IncomingMessage,
  limiter: RateLimiterMemory = rateLimiter,
): Promise<TokenVerificationResult> {
  // Rate-limit before anything else. An invalid or missing token used to skip
  // the limiter entirely, and every rejected request still pays for a full
  // argon2 verification, which is expensive enough to be a DoS lever on a
  // publicly reachable instance: a caller could send an endless stream of
  // bogus tokens and pin the server's CPU without ever hitting the limiter.
  const rateLimitKey = request ? getClientIp(request) : (token ?? "anonymous");
  try {
    await limiter.consume(rateLimitKey);
  } catch {
    return {
      isAuthorized: false,
      statusCode: 429,
      error: "Too many requests.",
      reason: "rateLimited",
    };
  }

  if (!token) {
    return {
      isAuthorized: false,
      statusCode: 400,
      error: "Missing token.",
      reason: "missingToken",
    };
  }

  if (!isVerifiedToken(token)) {
    if (isRejectedToken(token)) {
      // This process will never accept this token, so the refusal is final
      // without paying for the verification again. The file-divergence check
      // is skipped on purpose: this path has not paid for a verification, so
      // its file read would dominate, and first rejections always run it,
      // which is the case it was written for.
      recordRejectedTokenCacheHit();

      return {
        isAuthorized: false,
        statusCode: 401,
        error: "Invalid token.",
        reason: "invalidToken",
      };
    }

    // The client hashes with the shared parameters, so a hash carrying any
    // other block cannot be valid against this server. Checking before
    // argon2Verify refuses a mismatch for free, before any allocation or work
    // starts. Without it a caller could embed m=4194304,t=1000,p=1 and force a
    // multi-gigabyte allocation and 1000 rounds per request.
    if (!token.startsWith(ARGON2_HASH_PREFIX)) {
      return {
        isAuthorized: false,
        statusCode: 401,
        error: "Invalid token.",
        reason: "invalidToken",
      };
    }

    let isValidToken = false;
    let didComparisonRun = false;

    try {
      isValidToken = await argon2Verify({
        password: getSearchToken(),
        hash: token,
      });
      didComparisonRun = true;
    } catch (error) {
      void error;
    }

    if (!isValidToken) {
      // Only a comparison that ran to a result proves the token is dead. A
      // throw means either the token file could not be read, and caching that
      // would refuse a valid token for the rest of the process, or the hash
      // is malformed, and caching junk would only spend a slot on a refusal
      // that costs a prefix check plus a decode-time throw, not a full
      // verification.
      if (didComparisonRun) addRejectedToken(token);
      reportTokenFileChangeOnce();

      return {
        isAuthorized: false,
        statusCode: 401,
        error: "Invalid token.",
        reason: "invalidToken",
      };
    }
  }

  // Records a new session or refreshes an active one's last-seen time.
  addVerifiedToken(token);

  return { isAuthorized: true };
}
