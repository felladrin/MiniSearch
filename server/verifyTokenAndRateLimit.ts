import { argon2Verify } from "hash-wasm";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getSearchToken } from "./searchToken";
import { addVerifiedToken, isVerifiedToken } from "./verifiedTokens";

const rateLimiter = new RateLimiterMemory({
  points: 10,
  duration: 10,
});

export async function verifyTokenAndRateLimit(token: string | null): Promise<{
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

  try {
    await rateLimiter.consume(token);
  } catch {
    return {
      isAuthorized: false,
      statusCode: 429,
      error: "Too many requests.",
    };
  }

  return { isAuthorized: true };
}
