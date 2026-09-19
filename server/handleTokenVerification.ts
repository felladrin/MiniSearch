import type { IncomingMessage, ServerResponse } from "node:http";
import type { RateLimiterMemory } from "rate-limiter-flexible";
import {
  type AuthorizationSurface,
  recordAuthorizedRequest,
  recordRejectedRequest,
} from "./authorizationSinceLastRestart.ts";
import {
  type RejectionReason,
  verifyTokenAndRateLimit,
} from "./verifyTokenAndRateLimit.ts";

const SURFACES: [pathPrefix: string, surface: AuthorizationSurface][] = [
  ["/search", "search"],
  ["/page-content", "pageContent"],
  ["/thumbnail", "thumbnail"],
  ["/inference", "inference"],
];

/**
 * The rejections a person can land on by opening a search URL that was
 * bookmarked, shared or embedded before this instance rotated its token, or
 * one that had the token stripped from it on the way. A rate-limited request
 * is not one of them: the same URL works again a few seconds later, and the
 * page below would be telling that person the wrong story.
 */
const REASONS_WITH_A_PAGE: ReadonlySet<RejectionReason> = new Set([
  "missingToken",
  "invalidToken",
]);

/**
 * Static on purpose: nothing from the request goes in, so a caller cannot get
 * its own query, URL or header reflected back in a `text/html` body. The page
 * links to the root, where the app takes a token through `/api/config` the way
 * it always does; it carries no token itself and redirects nowhere, because
 * handing a token to any caller that turned up with a bad one would remove the
 * CSRF gate (`docs/security.md`, Search Token Lifecycle). No script and no
 * external asset, so it renders even where the instance is the only reachable
 * host.
 */
const EXPIRED_SEARCH_LINK_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>This search link has expired</title>
<style>
body { margin: 0; padding: 3rem 1.5rem; font: 1rem/1.6 system-ui, sans-serif; color: #1a1a1a; background: #fff; }
main { max-width: 36rem; margin: 0 auto; }
h1 { font-size: 1.5rem; line-height: 1.3; }
a { color: #0b5fff; }
@media (prefers-color-scheme: dark) { body { color: #ededed; background: #121212; } a { color: #8ab4ff; } }
</style>
</head>
<body>
<main>
<h1>This search link has expired</h1>
<p>This MiniSearch instance rotated its search token. Every search URL carries that token, so a bookmarked, shared or embedded search URL stops working when the token changes.</p>
<p><a href="/">Open MiniSearch</a> and search again from there. A search started on that page uses the current token.</p>
</main>
</body>
</html>
`;

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

/**
 * Whether the request looks like a browser navigation, which means its
 * `Accept` header asks for `text/html` by name. A navigation sends
 * `text/html,application/xhtml+xml,...`, while `fetch` sends only the wildcard
 * and API clients send `application/json` or nothing, and all of those keep
 * the JSON body. An entry with `q=0` is a refusal, not a request, so it does
 * not count either.
 */
function asksForHtml(request?: IncomingMessage): boolean {
  const accept = request?.headers.accept;
  if (typeof accept !== "string") return false;

  return accept.split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.split(";");
    if (mediaType.trim().toLowerCase() !== "text/html") return false;

    return !parameters.some((parameter) => {
      const [name, value] = parameter.split("=");
      return (
        name.trim().toLowerCase() === "q" && Number.parseFloat(value) === 0
      );
    });
  });
}

export async function handleTokenVerification(
  token: string | null,
  response: ServerResponse,
  request?: IncomingMessage,
  options?: { limiter?: RateLimiterMemory },
): Promise<{ shouldContinue: boolean }> {
  const result = await verifyTokenAndRateLimit(
    token,
    request,
    options?.limiter,
  );
  const surface = resolveSurface(request);

  if (!result.isAuthorized) {
    recordRejectedRequest(surface, result.reason);
    response.statusCode = result.statusCode;

    if (REASONS_WITH_A_PAGE.has(result.reason) && asksForHtml(request)) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(EXPIRED_SEARCH_LINK_PAGE);
      return { shouldContinue: false };
    }

    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: result.error }));
    return { shouldContinue: false };
  }

  recordAuthorizedRequest(surface);
  return { shouldContinue: true };
}
