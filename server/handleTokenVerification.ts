import type { ServerResponse } from "node:http";
import { verifyTokenAndRateLimit } from "./verifyTokenAndRateLimit";

/** Handles token verification and sends appropriate error responses if needed. */
export async function handleTokenVerification(
  token: string | null,
  response: ServerResponse,
): Promise<{ shouldContinue: boolean }> {
  const { isAuthorized, statusCode, error } =
    await verifyTokenAndRateLimit(token);

  if (!isAuthorized && statusCode && error) {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error }));
    return { shouldContinue: false };
  }

  return { shouldContinue: true };
}
