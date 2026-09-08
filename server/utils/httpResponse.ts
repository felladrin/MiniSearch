import type { ServerResponse } from "node:http";
import type { ZodError } from "zod";
import { safeEndResponse } from "./streamUtils.ts";

/**
 * Sends a JSON error response, guarding against a response that already began
 * writing.
 */
export function sendJsonError(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  if (response.headersSent) {
    safeEndResponse(response);
    return;
  }

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  safeEndResponse(response, JSON.stringify(payload));
}

/**
 * Sends a 400 response with the first Zod validation error message.
 */
export function sendValidationError(
  response: ServerResponse,
  error: ZodError,
): void {
  sendJsonError(response, 400, { error: error.issues[0].message });
}
