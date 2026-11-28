import { basename } from "node:path";
import debug from "debug";
import { convert as convertHtmlToPlainText } from "html-to-text";
import { strip as stripEmojis } from "node-emoji";
import type { SearxngTimeRange } from "../shared/searchTimeRange.ts";
import {
  type EngineFailure,
  getDegradedSearchTypes,
  incrementSearchesWithAllResultsDiscardedSinceLastRestart,
  incrementSearchesWithoutResultsSinceLastRestart,
  incrementSearchesWithUnresponsiveEnginesSinceLastRestart,
  recordRespondingEngines,
  recordUnresponsiveEngines,
  type SearchType,
  type UnresponsiveEngine,
} from "./searchesSinceLastRestart.ts";
import { CircuitBreaker } from "./utils/circuitBreaker.ts";
import { isOpenableUrl } from "./utils/openableUrl.ts";

const fileName = basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

const SERVICE_HOST = "127.0.0.1";
const SERVICE_PORT = 8888;
const SERVICE_BASE_URL = `http://${SERVICE_HOST}:${SERVICE_PORT}`;

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000;

// Text and image searches go out to different engine pools, so each type gets
// its own circuit: image engines failing must not block text searches that
// SearXNG is still serving.
const searxngCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60_000,
  // Once resetTimeout elapses, one healthy request closes the circuit again.
  successThreshold: 1,
});

interface SearxngSearchResult {
  title: string;
  url: string;
  content?: string;
  category?: string;
  template?: string;
  engine?: string;
  img_src?: string;
  iframe_src?: string;
  thumbnail?: string;
  thumbnail_src?: string;
}

interface SearxngSearchResponse {
  results?: SearxngSearchResult[];
  number_of_results?: number;
  unresponsive_engines?: unknown[];
}

const defaultSearchParams = {
  lang: "auto",
  safesearch: "1",
  format: "json",
} as const;

export async function startWebSearchService() {
  printMessage("Preparing service...");

  const maxAttempts = 30;
  const checkInterval = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const isReady = await getWebSearchStatus();
    if (isReady) {
      printMessage("Service ready!");
      return;
    }

    if (attempt === maxAttempts) {
      printMessage("Service not available!");
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }
}

function circuitKey(searchType: SearchType) {
  return `searxng:${searchType}`;
}

/**
 * The state of each search type's circuit in front of SearXNG, and how often
 * it has opened. An open circuit answers every search of its type with a
 * failure without calling SearXNG at all, which no other counter distinguishes
 * from SearXNG being down.
 */
export function getSearchCircuitStats(
  breaker: CircuitBreaker = searxngCircuitBreaker,
) {
  const circuitStateByType = {
    text: breaker.getState(circuitKey("text")),
    images: breaker.getState(circuitKey("images")),
  };
  const circuitOpensByType = {
    text: breaker.getOpens(circuitKey("text")),
    images: breaker.getOpens(circuitKey("images")),
  };
  const states = Object.values(circuitStateByType);
  return {
    // The worse state and the sum, so a monitor written when both types shared
    // one circuit still reads these two fields the way it did then.
    circuitState: states.includes("OPEN")
      ? "OPEN"
      : states.includes("HALF_OPEN")
        ? "HALF_OPEN"
        : "CLOSED",
    circuitOpens: circuitOpensByType.text + circuitOpensByType.images,
    circuitStateByType,
    circuitOpensByType,
  };
}

export async function getWebSearchStatus() {
  try {
    const response = await fetch(`${SERVICE_BASE_URL}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    const responseText = await response.text();
    return responseText.trim() === "OK";
  } catch {
    return false;
  }
}

/**
 * Whether searches can actually be served, which `/healthz` alone does not
 * answer: an open circuit fails every search without calling SearXNG at all,
 * so the probe keeps answering OK straight through a total outage, and engines
 * under suspension answer 200 with nothing usable. `degraded` means SearXNG is
 * up and reachable but search is not proven: the last search of either type was
 * lost to its engines, the image circuit is open, or a circuit is waiting for
 * one to prove it recovered. An open text circuit is `unhealthy`, since text
 * search is what every answer is built on; image search going down alone
 * leaves it serving.
 */
export async function getWebSearchServiceStatus(
  breaker: CircuitBreaker = searxngCircuitBreaker,
): Promise<"healthy" | "degraded" | "unhealthy"> {
  if (!(await getWebSearchStatus())) return "unhealthy";

  const textCircuit = breaker.getState(circuitKey("text"));
  if (textCircuit === "OPEN") return "unhealthy";

  // HALF_OPEN is reached on a timer, with no successful search behind it, so
  // reporting it as healthy would call the outage over because a minute passed.
  if (
    textCircuit === "HALF_OPEN" ||
    breaker.getState(circuitKey("images")) !== "CLOSED"
  ) {
    return "degraded";
  }

  return getDegradedSearchTypes().length > 0 ? "degraded" : "healthy";
}

function buildSearchUrl(
  query: string,
  searchType: SearchType,
  timeRange?: SearxngTimeRange,
) {
  const params = new URLSearchParams(defaultSearchParams);
  params.set("q", query);
  params.set("categories", searchType === "text" ? "general" : "images,videos");
  // Left out rather than sent empty, so a search with no time range reaches
  // SearXNG exactly as it did before the filter existed.
  if (timeRange) params.set("time_range", timeRange);
  return `${SERVICE_BASE_URL}/search?${params.toString()}`;
}

/**
 * Reads SearXNG's `unresponsive_engines` field, which reports each failed
 * engine as a `[engine, reason]` pair (e.g. `["google", "Timeout"]`,
 * `["bing", "Suspended: Access denied"]`). This is the only failure signal
 * available to MiniSearch, since SearXNG's own (very verbose) stdout/stderr is
 * intentionally discarded to keep the server logs clean.
 */
export function parseUnresponsiveEngines(
  unresponsiveEngines: unknown,
): UnresponsiveEngine[] {
  if (!Array.isArray(unresponsiveEngines)) return [];

  return (
    unresponsiveEngines
      .map((entry) => {
        const [engine, reason] = Array.isArray(entry)
          ? entry
          : [entry, undefined];
        return { engine: String(engine), reason: reason ? String(reason) : "" };
      })
      // An entry that names no engine says nothing and would tally under an empty
      // key; dropping it also keeps the search counted as one without results,
      // the way an absent `unresponsive_engines` field is.
      .filter(({ engine }) => engine.length > 0)
  );
}

export function formatUnresponsiveEngines(engines: UnresponsiveEngine[]) {
  return engines
    .map(({ engine, reason }) => (reason ? `${engine} (${reason})` : engine))
    .join(", ");
}

const SUSPENSION_REASON = /captcha|too many request|access denied/i;
const TIMEOUT_REASON = /timeout|timed out/i;

/**
 * Sorts SearXNG's free-form reason into the vocabulary `/status` publishes.
 * The raw string stays in the server log and in the thrown error, both of
 * which only the operator sees.
 */
function classifyEngineFailure(reason: string): EngineFailure {
  if (SUSPENSION_REASON.test(reason)) return "blocked";
  if (TIMEOUT_REASON.test(reason)) return "timeout";
  return "other";
}

/**
 * Whether every unresponsive engine is under a long suspension rather than a
 * transient error, so the whole set cannot recover within the retry backoff.
 */
function allEnginesSuspended(engines: UnresponsiveEngine[]): boolean {
  return (
    engines.length > 0 &&
    engines.every(({ reason }) => classifyEngineFailure(reason) === "blocked")
  );
}

/**
 * Counts the search as an unresponsive-engine failure and throws the error the
 * endpoint turns into a non-200. The fail-fast and the retry-exhausted paths
 * both end here, so a search costs one user-visible failure either way, and
 * `/status` learns which engines it cost it on.
 */
function failWithUnresponsiveEngines(
  searchType: SearchType,
  engines: UnresponsiveEngine[],
): never {
  incrementSearchesWithUnresponsiveEnginesSinceLastRestart();
  recordUnresponsiveEngines(
    searchType,
    engines.map(({ engine, reason }) => ({
      engine,
      failure: classifyEngineFailure(reason),
    })),
  );
  throw new Error(
    `No results returned from SearXNG. Unresponsive engines: ${formatUnresponsiveEngines(
      engines,
    )}`,
  );
}

/**
 * Waits out a retry backoff, or rejects with the signal's reason as soon as it
 * fires, so a search that has run out of time does not sleep past its deadline.
 */
function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A response that is not used still holds its connection until its body is
 * read or cancelled, so a failed answer has its body discarded before the
 * caller decides to retry or throw.
 */
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

async function performSearch(
  query: string,
  searchType: SearchType,
  signal?: AbortSignal,
  timeRange?: SearxngTimeRange,
): Promise<SearxngSearchResult[]> {
  const searchUrl = buildSearchUrl(query, searchType, timeRange);

  let retryReason = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_RETRY_DELAY * 2 ** (attempt - 1);
      printMessage(
        `SearXNG ${retryReason}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`,
      );
      await waitForRetry(delay, signal);
    }

    const response = await fetch(searchUrl, {
      headers: { Accept: "application/json" },
      signal,
    });

    if (!response.ok) {
      await discardBody(response);
      // Every 500 is retried; the last one leaves the loop for the throw after
      // it, whose message says the retries happened.
      if (response.status === 500) {
        retryReason = "returned 500";
        continue;
      }
      throw new Error(`SearXNG request failed with status ${response.status}`);
    }

    const data = (await response.json()) as SearxngSearchResponse;
    const results = Array.isArray(data.results) ? data.results : [];

    if (results.length === 0) {
      const unresponsiveEngines = parseUnresponsiveEngines(
        data.unresponsive_engines,
      );

      // SearXNG answers 200 with an empty result set when its engines are
      // rate-limited, suspended or CAPTCHA-challenged, so the only sign that
      // the search layer is down arrives in `unresponsive_engines`. Returned as
      // an empty array it is indistinguishable from a query that genuinely
      // matches nothing.
      if (unresponsiveEngines.length > 0) {
        if (allEnginesSuspended(unresponsiveEngines)) {
          failWithUnresponsiveEngines(searchType, unresponsiveEngines);
        }

        if (attempt < MAX_RETRIES) {
          retryReason = `returned no results (${formatUnresponsiveEngines(
            unresponsiveEngines,
          )})`;
          continue;
        }

        failWithUnresponsiveEngines(searchType, unresponsiveEngines);
      }

      incrementSearchesWithoutResultsSinceLastRestart();
      printMessage(
        "No results returned from SearXNG. No engine errors were reported; all engines returned zero results.",
      );
    }

    // Reached only when SearXNG answered, retries included, so a degradation
    // recorded on an earlier search stops being reported as current.
    recordRespondingEngines(searchType);

    return results;
  }

  throw new Error(
    `SearXNG request failed with status 500 after ${MAX_RETRIES} retries`,
  );
}

async function processSearchResults(
  query: string,
  searchType: SearchType,
  limit: number,
  breaker: CircuitBreaker,
  signal?: AbortSignal,
  timeRange?: SearxngTimeRange,
) {
  // An abort is thrown inside `execute`, so a stalled SearXNG counts as a
  // failure as soon as the deadline passes.
  const results = await breaker.execute(circuitKey(searchType), () =>
    performSearch(query, searchType, signal, timeRange),
  );
  const openableResults = openableUniqueResults(
    results,
    searchType === "text" ? (result) => result.url : graphicalResultKey,
  );

  if (searchType === "text") {
    const consideredResults = openableResults.slice(0, limit);
    const textualResults = await Promise.all(
      consideredResults.map(processTextualResult),
    );
    return reportDiscardedResults(
      filterNullResults(textualResults),
      consideredResults.length,
      searchType,
    );
  }

  // Dropped before the limit applies, so images without a thumbnail at the top
  // of the response cannot take the slots of usable ones further down.
  const graphicalResults = await Promise.all(
    openableResults.map(processGraphicalResult),
  );
  return reportDiscardedResults(
    filterNullResults(graphicalResults).slice(0, limit),
    openableResults.length,
    searchType,
  );
}

/**
 * Counts and logs when SearXNG returned results but every one that was looked at
 * got dropped during processing (e.g. missing title, snippet, or media source).
 * Without this, the discarded batch surfaces to the user as an opaque "Search
 * failed" with no server-side trace of why the non-empty response yielded
 * nothing usable.
 */
function reportDiscardedResults<T>(
  filteredResults: T[],
  processedResultCount: number,
  searchType: SearchType,
): T[] {
  if (processedResultCount > 0 && filteredResults.length === 0) {
    incrementSearchesWithAllResultsDiscardedSinceLastRestart();
    printMessage(
      `All ${processedResultCount} ${searchType} result(s) processed from the SearXNG response were discarded (missing title, snippet, or media source).`,
    );
  }
  return filteredResults;
}

/**
 * `signal` bounds the whole search, retries and backoff included: every fetch
 * gets it, and a backoff ends when it fires. Without one, a stalled SearXNG
 * holds the request for undici's 300 s default.
 *
 * `timeRange` is SearXNG's own `time_range`, and is left out for a search that
 * accepts any time.
 */
export async function fetchSearXNG(
  query: string,
  searchType: SearchType,
  limit = 30,
  breaker: CircuitBreaker = searxngCircuitBreaker,
  signal?: AbortSignal,
  timeRange?: SearxngTimeRange,
) {
  try {
    return await processSearchResults(
      query,
      searchType,
      limit,
      breaker,
      signal,
      timeRange,
    );
  } catch (error) {
    // Upstream failure (bad status, network error, malformed body, open
    // circuit) propagates so the endpoint can answer non-200; an empty array
    // then means exactly one thing: zero results.
    const errorMessage = error instanceof Error ? error.message : String(error);
    printMessage(`Search failed: ${errorMessage}`);
    throw error;
  }
}

/**
 * One text search that adds to a search SearXNG has already answered (the
 * official lane). It is allowed to fail, so it skips what `fetchSearXNG` does to
 * protect the user's own search: no retry, no circuit breaker, and no
 * engine-health counters. Otherwise an empty `site:` answer could slow down,
 * open the circuit for, or mark degraded the searches users are waiting on.
 */
export async function fetchSupplementarySearXNG(
  query: string,
  limit: number,
  signal?: AbortSignal,
  timeRange?: SearxngTimeRange,
) {
  // The lane's results are merged into the main ones, so they have to honor
  // the same time range, or a filtered search shows unfiltered pages.
  const response = await fetch(buildSearchUrl(query, "text", timeRange), {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    await discardBody(response);
    throw new Error(`SearXNG request failed with status ${response.status}`);
  }

  const data = (await response.json()) as SearxngSearchResponse;
  const results = Array.isArray(data.results) ? data.results : [];
  const textualResults = await Promise.all(
    openableUniqueResults(results, (result) => result.url)
      .slice(0, limit)
      .map(processTextualResult),
  );
  return filterNullResults(textualResults);
}

async function processGraphicalResult(result: SearxngSearchResult) {
  const thumbnailSource =
    result.category === "videos" ? result.thumbnail : result.thumbnail_src;

  // A grid tile is the thumbnail: without one there is nothing to show but the
  // host name, and SearXNG leaves the field out often enough (video engines
  // especially) that keeping these fills the carousel with text placeholders.
  if (!thumbnailSource) return null;

  // Empty string, not undefined: the client reads the tuple positionally and
  // treats an empty source as "no link to the full image".
  const sourceUrl =
    (result.category === "videos"
      ? result.iframe_src || result.url
      : result.img_src) ?? "";

  return [result.title, result.url, thumbnailSource, sourceUrl] as [
    title: string,
    url: string,
    thumbnailSource: string,
    sourceUrl: string,
  ];
}

function processSnippet(snippet: string): string {
  const processedSnippet = stripEmojis(
    convertHtmlToPlainText(snippet, { wordwrap: false }).trim(),
    { preserveSpaces: true },
  );

  if (processedSnippet.startsWith("[data:image")) return "";

  return processedSnippet;
}

async function processTextualResult(result: SearxngSearchResult) {
  try {
    if (!result.content) return null;

    const title = convertHtmlToPlainText(result.title, {
      wordwrap: false,
    }).trim();

    const snippet = processSnippet(result.content);

    if (!title || !snippet) return null;

    return [title, snippet, result.url] as [
      title: string,
      content: string,
      url: string,
    ];
  } catch (error) {
    console.warn(
      `Failed to process textual result: ${result.url}`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * What makes an image or video result distinct: the full-size source, then the
 * thumbnail. A gallery page returns many different images under one page URL,
 * so keying on the page would keep only the first of them.
 */
function graphicalResultKey(result: SearxngSearchResult): string {
  if (result.category === "videos") {
    return result.iframe_src || result.url;
  }
  return result.img_src || result.thumbnail_src || result.url;
}

// Runs before the limit is applied, so a dropped link does not take the slot
// of a result that would have made the cut.
function openableUniqueResults(
  results: SearxngSearchResult[],
  keyOf: (result: SearxngSearchResult) => string,
): SearxngSearchResult[] {
  const keys = new Set<string>();
  const unopenableEngines: string[] = [];
  const kept = results.filter((result) => {
    if (!isOpenableUrl(result.url)) {
      unopenableEngines.push(result.engine ?? "unknown");
      return false;
    }
    const key = keyOf(result);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  // Engine names only: the url is downstream of the query, which never reaches
  // the log.
  if (unopenableEngines.length > 0) {
    printMessage(
      `Dropped ${unopenableEngines.length} SearXNG result(s) whose link no browser can open, from: ${[...new Set(unopenableEngines)].join(", ")}.`,
    );
  }
  return kept;
}

function filterNullResults<T>(results: (T | null)[]): T[] {
  return results.filter((result): result is T => result !== null);
}
