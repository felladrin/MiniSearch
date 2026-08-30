import type { ServerResponse } from "node:http";
import type { PreviewServer, ViteDevServer } from "vite";
import { handleTokenVerification } from "./handleTokenVerification.ts";
import {
  recordThumbnailBlocked,
  recordThumbnailDropped,
  recordThumbnailRequested,
} from "./searchesSinceLastRestart.ts";
import { resolvePublicUrl } from "./utils/publicUrl.ts";
import { readCappedBytes, safeEndResponse } from "./utils/streamUtils.ts";
import { thumbnailRateLimiter } from "./verifyTokenAndRateLimit.ts";

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
 * `resolvePublicUrl`'s DNS lookup does not take a signal, so it is raced
 * against the hop deadline: a hanging resolver would otherwise add its own
 * timeout on top of the one that is documented to bound the whole chain.
 */
function timeoutError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "TimeoutError";
  return error;
}

function resolveWithinDeadline(
  deadline: AbortSignal,
  work: Promise<URL>,
): Promise<URL> {
  if (deadline.aborted) return Promise.reject(timeoutError());
  return new Promise<URL>((resolve, reject) => {
    const onAbort = () => reject(timeoutError());
    deadline.addEventListener("abort", onAbort, { once: true });
    work.then(
      (url) => {
        deadline.removeEventListener("abort", onAbort);
        resolve(url);
      },
      (error) => {
        deadline.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Follows redirects by hand so that every hop is validated, the way
 * `pageContentService` does: `redirect: "follow"` would let a public host
 * bounce the server into a private address. The chain shares one deadline, so
 * a redirector cannot buy extra time per hop.
 *
 * The URL is client-supplied (it arrives as a query parameter), so on failure
 * it is not logged, matching `/page-content`; the outcome is counted instead.
 */
async function fetchThumbnail(rawUrl: string): Promise<ThumbnailOutcome> {
  let target = rawUrl;
  const deadline = AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS);

  for (let hop = 0; hop <= MAX_THUMBNAIL_REDIRECTS; hop++) {
    let url: URL;
    try {
      url = await resolveWithinDeadline(deadline, resolvePublicUrl(target));
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return { kind: "failed", reason: "TimeoutError" };
      }
      return { kind: "blocked" };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: deadline,
      });
    } catch (error) {
      return {
        kind: "failed",
        reason: error instanceof Error ? error.name : String(error),
      };
    }

    const location = response.headers.get("location");
    if (isRedirect(response.status) && location) {
      await response.body?.cancel().catch(() => {});
      try {
        target = new URL(location, url).toString();
      } catch {
        return { kind: "failed", reason: "malformed redirect location" };
      }
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { kind: "failed", reason: `HTTP ${response.status}` };
    }

    const normalizedType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ACCEPTED_CONTENT_TYPES.includes(normalizedType)) {
      await response.body?.cancel().catch(() => {});
      return {
        kind: "failed",
        reason: normalizedType
          ? `not an accepted image type (${normalizedType})`
          : "no content type",
      };
    }

    let bytes: Uint8Array;
    try {
      ({ bytes } = await readCappedBytes(response, MAX_THUMBNAIL_BYTES));
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
        // Covers both refusals resolvePublicUrl reports the same way: a host
        // in private space and a host that does not resolve.
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
