import type { ServerResponse } from "node:http";
import type { PreviewServer, ViteDevServer } from "vite";
import { handleTokenVerification } from "./handleTokenVerification.ts";
import {
  recordThumbnailBlocked,
  recordThumbnailDropped,
  recordThumbnailRequested,
} from "./searchesSinceLastRestart.ts";
import { resolvePublicUrl } from "./utils/publicUrl.ts";
import { readCappedBytes } from "./utils/streamUtils.ts";

/**
 * Off the critical path: the search response no longer waits on a thumbnail,
 * so the budget is set against how long a user tolerates a placeholder tile,
 * not against the whole grid.
 */
const THUMBNAIL_TIMEOUT_MS = 3000;
const MAX_THUMBNAIL_REDIRECTS = 3;
const MAX_THUMBNAIL_BYTES = 500_000;

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

type ThumbnailOutcome =
  | { kind: "image"; bytes: Uint8Array; contentType: string }
  | { kind: "blocked" }
  | { kind: "failed"; reason: string };

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304;
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
      url = await resolvePublicUrl(target);
    } catch {
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
      target = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { kind: "failed", reason: `HTTP ${response.status}` };
    }

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith("image/")) {
      await response.body?.cancel().catch(() => {});
      return {
        kind: "failed",
        reason: contentType
          ? `not an image (${contentType})`
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

    return { kind: "image", bytes, contentType };
  }

  return { kind: "failed", reason: "redirected too many times" };
}

function serveThumbnail(
  response: ServerResponse,
  entry: CachedThumbnail,
): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", entry.contentType);
  // Private: the endpoint is token-gated, so one browser's fetched thumbnails
  // must not be shared with another user of the same browser.
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
 * the same token verification as `/search`, with an in-process LRU in front
 * of the upstream host. The search endpoint returns thumbnail URLs as they
 * came back from SearXNG; the client loads each tile from here, so a dead
 * thumbnail host delays one tile instead of the whole grid.
 */
export function thumbnailEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/thumbnail")) return next();

    const url = new URL(request.url, `http://${request.headers.host}`);

    const { shouldContinue } = await handleTokenVerification(
      url.searchParams.get("token"),
      response,
      request,
    );

    if (!shouldContinue) return;

    const rawTarget = url.searchParams.get("u");
    if (!rawTarget) {
      serveError(response, 400, "Missing thumbnail URL");
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
      serveError(
        response,
        403,
        "Refusing to fetch thumbnail from a non-public address",
      );
      return;
    }

    if (outcome.kind === "failed") {
      recordThumbnailDropped();
      console.warn(`Thumbnail fetch failed: ${outcome.reason}`);
      serveError(response, 502, "Thumbnail could not be fetched");
      return;
    }

    const entry: CachedThumbnail = {
      bytes: outcome.bytes,
      contentType: outcome.contentType,
    };
    setCachedThumbnail(rawTarget, entry);
    serveThumbnail(response, entry);
  });
}
