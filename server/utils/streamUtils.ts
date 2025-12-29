import type { ServerResponse } from "node:http";

/**
 * Calculate backoff time with exponential jitter
 * @param attempt - Current attempt number (1-based)
 * @param baseDelayMs - Base delay in milliseconds (default: 100ms)
 * @param maxDelayMs - Maximum delay in milliseconds (default: 5000ms)
 * @returns Calculated delay in milliseconds
 */
export function calculateBackoffTime(
  attempt: number,
  baseDelayMs = 100,
  maxDelayMs = 5000,
): number {
  const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  return delay * (0.7 + Math.random() * 0.3);
}

/**
 * Check if a response is still writable
 * @param response - The HTTP response object
 * @returns boolean indicating if the response can still be written to
 */
export function isResponseWritable(response: ServerResponse): boolean {
  return !response.writableEnded && !response.destroyed;
}

/**
 * Safely write to a response stream
 * @param response - The HTTP response object
 * @param data - Data to write
 * @returns boolean indicating if the write was successful
 */
export function safeWriteResponse(
  response: ServerResponse,
  data: string,
): boolean {
  if (!isResponseWritable(response)) return false;

  try {
    return response.write(data);
  } catch (error) {
    console.error("Failed to write to response:", error);
    return false;
  }
}

/**
 * Safely end a response
 * @param response - The HTTP response object
 * @param data - Optional data to write before ending
 */
export function safeEndResponse(response: ServerResponse, data?: string): void {
  if (response.writableEnded || response.destroyed) return;

  try {
    if (data) {
      response.end(data);
    } else {
      response.end();
    }
  } catch (error) {
    console.error("Failed to end response:", error);
    response.destroy();
  }
}

/**
 * Set response headers if they haven't been set yet
 * @param response - The HTTP response object
 * @param headers - Headers to set
 */
export function setResponseHeadersIfNotSet(
  response: ServerResponse,
  headers: Record<string, string | string[] | number | undefined>,
): void {
  if (response.headersSent) return;

  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && !response.getHeader(key)) {
      response.setHeader(key, value);
    }
  }
}

/**
 * Send an error response
 * @param response - The HTTP response object
 * @param statusCode - HTTP status code
 * @param error - Error message or object
 */
export function sendErrorResponse(
  response: ServerResponse,
  statusCode: number,
  error: string | Record<string, unknown>,
): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }

  try {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json");
    const errorObj = typeof error === "string" ? { error } : error;
    response.end(JSON.stringify(errorObj));
  } catch (err) {
    console.error("Failed to send error response:", err);
    response.destroy();
  }
}
