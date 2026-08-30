import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type AuthorizationSurface,
  recordAuthorizedRequest,
  recordRejectedRequest,
} from "./authorizationSinceLastRestart.ts";
import { verifyTokenAndRateLimit } from "./verifyTokenAndRateLimit.ts";

const SURFACES: [pathPrefix: string, surface: AuthorizationSurface][] = [
  ["/search", "search"],
  ["/page-content", "pageContent"],
  ["/thumbnail", "thumbnail"],
  ["/inference", "inference"],
];

/**
 * The endpoint family a request was aimed at. `request.url` carries the query
 * string too, but the match is anchored at the start of it and only the label
 * is kept, so no part of a query can reach a counter or change one.
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
  const surface = resolveSurface(request);

  if (!result.isAuthorized) {
    recordRejectedRequest(surface, result.reason);
    response.statusCode = result.statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: result.error }));
    return { shouldContinue: false };
  }

  recordAuthorizedRequest(surface);
  return { shouldContinue: true };
}
