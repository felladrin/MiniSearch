import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { argon2Verify } from "hash-wasm";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getSearchToken } from "./searchToken.ts";
import { addVerifiedToken, isVerifiedToken } from "./verifiedTokens.ts";

export const RATE_LIMIT_POINTS = 10;
export const RATE_LIMIT_DURATION_SECONDS = 10;

const rateLimiter = new RateLimiterMemory({
  points: RATE_LIMIT_POINTS,
  duration: RATE_LIMIT_DURATION_SECONDS,
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

export async function verifyTokenAndRateLimit(
  token: string | null,
  request?: IncomingMessage,
): Promise<TokenVerificationResult> {
  // Rate-limit before anything else. An invalid or missing token used to skip
  // the limiter entirely, and every rejected request still pays for a full
  // argon2 verification, which is expensive enough to be a DoS lever on a
  // publicly reachable instance: a caller could send an endless stream of
  // bogus tokens and pin the server's CPU without ever hitting the limiter.
  const rateLimitKey = request ? getClientIp(request) : (token ?? "anonymous");
  try {
    await rateLimiter.consume(rateLimitKey);
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
    let isValidToken = false;

    try {
      isValidToken = await argon2Verify({
        password: getSearchToken(),
        hash: token,
      });
    } catch (error) {
      void error;
    }

    if (!isValidToken) {
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
