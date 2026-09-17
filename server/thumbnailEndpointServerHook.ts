import type { IncomingMessage, ServerResponse } from "node:http";
import type { PreviewServer, ViteDevServer } from "vite";
import { handleTokenVerification } from "./handleTokenVerification.ts";
import {
  recordThumbnailBlocked,
  recordThumbnailDropped,
  recordThumbnailRequested,
} from "./searchesSinceLastRestart.ts";
import {
  readCappedStream,
  requestPinnedToVettedAddress,
} from "./utils/pinnedFetch.ts";
import { resolvePublicUrlAndAddress } from "./utils/publicUrl.ts";
import { safeEndResponse } from "./utils/streamUtils.ts";
import { thumbnailRateLimiter } from "./verifyTokenAndRateLimit.ts";

/**
 * Security review for issue #2524 (audited 2026-09-17). What each item of
 * the audit checklist maps to:
 *
 * - Private ranges (10/8, 172.16/12, 192.168/16), link-local including
 *   the cloud metadata address 169.254.169.254, loopback (127/8, ::1),
 *   CGNAT 100.64/10, multicast and reserved space, and the IPv4-mapped /
 *   IPv4-compatible IPv6 spellings: `BLOCKED_CIDRS` and `isBlockedAddress`
 *   in `server/utils/publicUrl.ts`, enforced per hop by
 *   `resolvePublicUrlAndAddress`. NAT64/6to4/Teredo are refused wholesale
 *   because an embedded IPv4 cannot be vetted.
 * - DNS rebinding: closed. The vetted address is pinned to the socket by
 *   `requestPinnedToVettedAddress` (`server/utils/pinnedFetch.ts`); the
 *   connect never re-resolves, so a second, private DNS answer cannot be
 *   reached. TLS SNI and certificate verification still run against the
 *   original hostname, as does the `Host` header.
 * - URL length: `MAX_THUMBNAIL_URL_LENGTH` (2048), refused before any
 *   work is done.
 * - Schemes: http/https only, in `resolvePublicUrlAndAddress`.
 * - Redirects: followed by hand below, every hop re-validated under one
 *   shared deadline.
 * - Content-Type: raster-only allowlist below; SVG is deliberately
 *   excluded because served same-origin it is a script-carrying document.
 * - Response size: `MAX_THUMBNAIL_BYTES` via `readCappedStream`.
 * - Timeout: `THUMBNAIL_TIMEOUT_MS`, shared across DNS and every hop.
 * - Rate limiting: per client IP via `thumbnailRateLimiter`, a dedicated
 *   60-per-10s budget so a grid of tiles cannot exhaust the search
 *   budget. There is no separate global limiter: the per-client limiter
 *   plus the shared token gate bound the total, and a global cap would let
 *   one caller's grid starve every other user's tiles.
 *
 * Residual risk after this change: the endpoint still fetches arbitrary
 * public URLs, so a caller can use it to GET any public host — bounded by
 * the rate limiter, the size cap and the timeout, and useful only for
 * raster images. The pinned address is the one DNS gave at vetting time; a
 * host whose DNS later repoints stays unreachable here until its records
 * are re-checked, which is the pin working, not failing. Content itself is
 * untrusted: served same-origin, it carries `nosniff` and a sandbox CSP,
 * and only raster types pass the allowlist, so no script-carrying format
 * reaches a browser. `/page-content` has not adopted the pin yet and still
 * carries the old rebinding residual (see `resolvePublicUrl`'s docstring).
 */

/**
 * Off the critical path: the search response no longer waits on a thumbnail,
 * so the budget is set against how long a user tolerates a placeholder tile,
 * not against the whole grid. It bounds the redirect hops too, DNS included.
 */
const THUMBNAIL_TIMEOUT_MS = 3000;
const MAX_THUMBNAIL_REDIRECTS = 3;
const MAX_THUMBNAIL_BYTES = 500_000;
/** Matches the cap `/page-content` puts on its client-supplied URLs. */
const MAX_THUMBNAIL_URL_LENGTH = 2048;

/**
 * Raster types only, by name: the response is served same-origin, and an SVG
 * loaded by direct navigation is a document whose scripts would run on this
 * origin. A data URL in an `<img>` (what the old search path produced) stays
 * inert; this endpoint must not open that door.
 */
const ACCEPTED_CONTENT_TYPES = [
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon",
];

/**
 * In-process LRU in front of the upstream hosts: re-running a search,
 * restoring history and the browser's own cache all miss at the same time
 * after a restart, and a thumbnail host should not be asked for the same
 * bytes twice while they are still held.
 */
const MAX_CACHE_ENTRIES = 100;
const MAX_CACHE_BYTES = 50 * 1024 * 1024;

interface CachedThumbnail {
  bytes: Uint8Array;
  contentType: string;
}

const thumbnailCache = new Map<string, CachedThumbnail>();
let thumbnailCacheBytes = 0;

export function getThumbnailCacheLimits(): {
  entries: number;
  bytes: number;
} {
  return { entries: MAX_CACHE_ENTRIES, bytes: MAX_CACHE_BYTES };
}

function getCachedThumbnail(key: string): CachedThumbnail | undefined {
  const entry = thumbnailCache.get(key);
  if (!entry) return undefined;
  // A Map iterates in insertion order, so re-inserting the key moves it to
  // the end, away from the eviction side.
  thumbnailCache.delete(key);
  thumbnailCache.set(key, entry);
  return entry;
}

function setCachedThumbnail(key: string, entry: CachedThumbnail): void {
  const previous = thumbnailCache.get(key);
  if (previous) thumbnailCacheBytes -= previous.bytes.byteLength;
  thumbnailCache.set(key, entry);
  thumbnailCacheBytes += entry.bytes.byteLength;

  while (
    thumbnailCache.size > MAX_CACHE_ENTRIES ||
    thumbnailCacheBytes > MAX_CACHE_BYTES
  ) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (oldestKey === undefined) break;
    const evicted = thumbnailCache.get(oldestKey);
    thumbnailCache.delete(oldestKey);
    if (evicted) thumbnailCacheBytes -= evicted.bytes.byteLength;
  }
}

/**
 * Drops the in-process cache. The cache is module state, so tests that care
 * about exact entry counts need a clean slate.
 */
export function resetThumbnailCache(): void {
  thumbnailCache.clear();
  thumbnailCacheBytes = 0;
}

type ThumbnailOutcome =
  | { kind: "image"; bytes: Uint8Array; contentType: string }
  | { kind: "blocked" }
  | { kind: "failed"; reason: string };

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304;
}

/**
 * `resolvePublicUrlAndAddress`'s DNS lookup does not take a signal, so it
 * is raced against the hop deadline: a hanging resolver would otherwise
 * add its own timeout on top of the one that is documented to bound the
 * whole chain.
 */
function timeoutError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "TimeoutError";
  return error;
}

function resolveWithinDeadline<T>(
  deadline: AbortSignal,
  work: Promise<T>,
): Promise<T> {
  if (deadline.aborted) return Promise.reject(timeoutError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(timeoutError());
    deadline.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        deadline.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        deadline.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Follows redirects by hand so that every hop is validated and pinned, the
 * way `pageContentService` follows them: `redirect: "follow"` would let a
 * public host bounce the server into a private address. The chain shares one
 * deadline, so a redirector cannot buy extra time per hop.
 *
 * Each hop connects to the address `resolvePublicUrlAndAddress` vetted, via
 * `requestPinnedToVettedAddress`, so the address checked is the address
 * reached: a second, private DNS answer has no path to the socket.
 *
 * The URL is client-supplied (it arrives as a query parameter), so on failure
 * it is not logged, matching `/page-content`; the outcome is counted instead.
 */
async function fetchThumbnail(rawUrl: string): Promise<ThumbnailOutcome> {
  let target = rawUrl;
  const deadline = AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS);

  for (let hop = 0; hop <= MAX_THUMBNAIL_REDIRECTS; hop++) {
    let url: URL;
    let address: string;
    try {
      ({ url, address } = await resolveWithinDeadline(
        deadline,
        resolvePublicUrlAndAddress(target),
      ));
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return { kind: "failed", reason: "TimeoutError" };
      }
      return { kind: "blocked" };
    }

    let response: IncomingMessage;
    try {
      response = await requestPinnedToVettedAddress(url, address, {
        signal: deadline,
      });
    } catch (error) {
      return {
        kind: "failed",
        reason: error instanceof Error ? error.name : String(error),
      };
    }

    const location = response.headers.location;
    if (isRedirect(response.statusCode ?? 0) && location) {
      // Tear the socket down rather than drain a body nobody asked for.
      response.destroy();
      try {
        target = new URL(location, url).toString();
      } catch {
        return { kind: "failed", reason: "malformed redirect location" };
      }
      continue;
    }

    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      response.destroy();
      return { kind: "failed", reason: `HTTP ${status}` };
    }

    const normalizedType = (response.headers["content-type"] ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ACCEPTED_CONTENT_TYPES.includes(normalizedType)) {
      response.destroy();
      return {
        kind: "failed",
        reason: normalizedType
          ? `not an accepted image type (${normalizedType})`
          : "no content type",
      };
    }

    let bytes: Uint8Array;
    try {
      ({ bytes } = await readCappedStream(response, MAX_THUMBNAIL_BYTES));
    } catch (error) {
      return {
        kind: "failed",
        reason: error instanceof Error ? error.name : String(error),
      };
    }

    if (bytes.byteLength === 0) {
      return { kind: "failed", reason: "empty body" };
    }

    return { kind: "image", bytes, contentType: normalizedType };
  }

  return { kind: "failed", reason: "redirected too many times" };
}

function serveThumbnail(
  response: ServerResponse,
  entry: CachedThumbnail,
): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", entry.contentType);
  // Defense in depth on top of the raster allowlist: even if a type ever
  // slips through, the browser must not interpret it as anything else.
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  // Private: the endpoint is token-gated and one browser must not hand
  // another user's fetched tiles to it. (The in-process LRU is shared across
  // sessions, but it only serves bytes the upstream already published.)
  response.setHeader("Cache-Control", "private, max-age=3600");
  response.end(Buffer.from(entry.bytes));
}

function serveError(
  response: ServerResponse,
  statusCode: number,
  error: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  // A refusal or an upstream failure is not a stable property of the URL, so
  // the browser must not hold on to it.
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({ error }));
}

/**
 * Serves `/thumbnail?u=<url>`: one search-result thumbnail at a time, behind
 * the same token verification as `/search` (on its own rate-limit budget,
 * since one grid fans out into up to 30 of these), with an in-process LRU in
 * front of the upstream host. The search endpoint returns thumbnail URLs as
 * they came back from SearXNG; the client loads each tile from here, so a
 * dead thumbnail host delays one tile instead of the whole grid.
 */
export function thumbnailEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/thumbnail")) return next();

    try {
      const url = new URL(request.url, `http://${request.headers.host}`);

      const { shouldContinue } = await handleTokenVerification(
        url.searchParams.get("token"),
        response,
        request,
        { limiter: thumbnailRateLimiter },
      );

      if (!shouldContinue) return;

      const rawTarget = url.searchParams.get("u");
      if (!rawTarget) {
        serveError(response, 400, "Missing thumbnail URL");
        return;
      }

      if (rawTarget.length > MAX_THUMBNAIL_URL_LENGTH) {
        serveError(response, 400, "Thumbnail URL too long");
        return;
      }

      recordThumbnailRequested();

      const cached = getCachedThumbnail(rawTarget);
      if (cached) {
        serveThumbnail(response, cached);
        return;
      }

      const outcome = await fetchThumbnail(rawTarget);

      if (outcome.kind === "blocked") {
        recordThumbnailBlocked();
        // `dropped` is the total of what never reached the client, blocked
        // included, so `requested` minus `dropped` stays the served count.
        recordThumbnailDropped();
        // Covers both refusals resolvePublicUrlAndAddress reports the same
        // way: a host in private space and a host that does not resolve.
        serveError(
          response,
          403,
          "Refusing to fetch a thumbnail from a non-public or unresolvable address",
        );
        return;
      }

      if (outcome.kind === "failed") {
        recordThumbnailDropped();
        console.warn(`Thumbnail fetch failed: ${outcome.reason}`);
        serveError(response, 502, "Thumbnail could not be fetched");
        return;
      }

      // Failures are never cached: a transient upstream refusal must be able
      // to recover on the next tile load.
      const entry: CachedThumbnail = {
        bytes: outcome.bytes,
        contentType: outcome.contentType,
      };
      setCachedThumbnail(rawTarget, entry);
      serveThumbnail(response, entry);
    } catch {
      // Vite's connect stack does not await async middleware, so a throw here
      // would be an unhandled rejection that takes the process down.
      response.statusCode = 500;
      safeEndResponse(
        response,
        JSON.stringify({ error: "Internal server error" }),
      );
    }
  });
}
