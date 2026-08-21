import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type AuthorizationSurface,
  recordAuthorizedRequest,
  recordRejectedRequest,
} from "./rejectionsSinceLastRestart.ts";
import { verifyTokenAndRateLimit } from "./verifyTokenAndRateLimit.ts";

const SURFACES: [pathPrefix: string, surface: AuthorizationSurface][] = [
  ["/search", "search"],
  ["/page-content", "pageContent"],
  ["/inference", "inference"],
];

/**
 * The endpoint family a request was aimed at, taken from the path alone. The
 * query string is never read, so nothing here can reach the search terms.
 */
function resolveSurface(request?: IncomingMessage): AuthorizationSurface {
  const path = request?.url ?? "";
  const match = SURFACES.find(([pathPrefix]) => path.startsWith(pathPrefix));
  return match ? match[1] : "other";
}

export async function handleTokenVerification(
  token: string | null,
  response: ServerResponse,
  request?: IncomingMessage,
): Promise<{ shouldContinue: boolean }> {
  const result = await verifyTokenAndRateLimit(token, request);

  if (!result.isAuthorized) {
    recordRejectedRequest(resolveSurface(request), result.reason);
    response.statusCode = result.statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: result.error }));
    return { shouldContinue: false };
  }

  recordAuthorizedRequest();
  return { shouldContinue: true };
}
