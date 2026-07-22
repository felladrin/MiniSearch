import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyTokenAndRateLimit } from "./verifyTokenAndRateLimit";

/** Handles token verification and sends appropriate error responses if needed. */
export async function handleTokenVerification(
  token: string | null,
  response: ServerResponse,
  request?: IncomingMessage,
): Promise<{ shouldContinue: boolean }> {
  const { isAuthorized, statusCode, error } = await verifyTokenAndRateLimit(
    token,
    request,
  );

  if (!isAuthorized && statusCode && error) {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error }));
    return { shouldContinue: false };
  }

  return { shouldContinue: true };
}
