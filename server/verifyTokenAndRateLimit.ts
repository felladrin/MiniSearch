import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { argon2Verify } from "hash-wasm";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getSearchToken } from "./searchToken";
import { addVerifiedToken, isVerifiedToken } from "./verifiedTokens";

const rateLimiter = new RateLimiterMemory({
  points: 10,
  duration: 10,
});

/** Takes the rightmost X-Forwarded-For entry (the one our proxy appended), validated with `net.isIP()`. */
export function getClientIp(request: IncomingMessage): string {
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
  return request.socket.remoteAddress || "unknown";
}

export async function verifyTokenAndRateLimit(
  token: string | null,
  request?: IncomingMessage,
): Promise<{
  isAuthorized: boolean;
  statusCode?: number;
  error?: string;
}> {
  if (!token) {
    return {
      isAuthorized: false,
      statusCode: 400,
      error: "Missing token.",
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

    if (isValidToken) {
      addVerifiedToken(token);
    } else {
      return {
        isAuthorized: false,
        statusCode: 401,
        error: "Invalid token.",
      };
    }
  }

  const rateLimitKey = request ? getClientIp(request) : token;

  try {
    await rateLimiter.consume(rateLimitKey);
  } catch {
    return {
      isAuthorized: false,
      statusCode: 429,
      error: "Too many requests.",
    };
  }

  return { isAuthorized: true };
}
