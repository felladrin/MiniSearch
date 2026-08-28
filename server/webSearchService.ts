import { basename } from "node:path";
import debug from "debug";
import { convert as convertHtmlToPlainText } from "html-to-text";
import { strip as stripEmojis } from "node-emoji";
import {
  incrementSearchesWithAllResultsDiscardedSinceLastRestart,
  incrementSearchesWithoutResultsSinceLastRestart,
  incrementSearchesWithUnresponsiveEnginesSinceLastRestart,
} from "./searchesSinceLastRestart.ts";
import { CircuitBreaker } from "./utils/circuitBreaker.ts";

const fileName = basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

const SERVICE_HOST = "127.0.0.1";
const SERVICE_PORT = 8888;
const SERVICE_BASE_URL = `http://${SERVICE_HOST}:${SERVICE_PORT}`;

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000;

// successThreshold: 1 preserves the previous breaker's single-success reset:
// once resetTimeout elapses, one healthy request closes the circuit again.
const searxngCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60_000,
  successThreshold: 1,
});

type SearchType = "text" | "images";

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

/**
 * The state of the circuit in front of SearXNG, and how often it has opened. An
 * open circuit answers every search with a failure without calling SearXNG at
 * all, which no other counter distinguishes from SearXNG being down.
 */
export function getSearchCircuitStats() {
  return {
    circuitState: searxngCircuitBreaker.getState("searxng"),
    circuitOpens: searxngCircuitBreaker.getOpens("searxng"),
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

function buildSearchUrl(query: string, searchType: SearchType) {
  const params = new URLSearchParams(defaultSearchParams);
  params.set("q", query);
  params.set("categories", searchType === "text" ? "general" : "images,videos");
  return `${SERVICE_BASE_URL}/search?${params.toString()}`;
}

/**
 * Extracts a concise, human-readable reason from SearXNG's `unresponsive_engines`
 * field. SearXNG reports each failed engine as a `[engine, reason]` pair (e.g.
 * `["google", "Timeout"]`, `["bing", "Suspended: Access denied"]`). This is the
 * only failure signal available to MiniSearch, since SearXNG's own (very verbose)
 * stdout/stderr is intentionally discarded to keep the server logs clean.
 *
 * @returns A summary string, or null when no engine errors were reported.
 */
export function describeUnresponsiveEngines(
  unresponsiveEngines: unknown,
): string | null {
  if (!Array.isArray(unresponsiveEngines) || unresponsiveEngines.length === 0) {
    return null;
  }

  return unresponsiveEngines
    .map((entry) => {
      if (Array.isArray(entry)) {
        const [engine, reason] = entry;
        return reason ? `${engine} (${reason})` : String(engine);
      }
      return String(entry);
    })
    .join(", ");
}

const SUSPENSION_REASON = /captcha|too many request|access denied/i;

/**
 * Whether every unresponsive engine is under a long suspension rather than a
 * transient error, so the whole set cannot recover within the retry backoff.
 */
function allEnginesSuspended(unresponsiveEngines: unknown): boolean {
  if (!Array.isArray(unresponsiveEngines) || unresponsiveEngines.length === 0) {
    return false;
  }
  return unresponsiveEngines.every((entry) => {
    const reason = Array.isArray(entry) ? entry[1] : undefined;
    return typeof reason === "string" && SUSPENSION_REASON.test(reason);
  });
}

/**
 * Counts the search as an unresponsive-engine failure and throws the error the
 * endpoint turns into a non-200. The fail-fast and the retry-exhausted paths
 * both end here, so a search costs one user-visible failure either way.
 */
function failWithUnresponsiveEngines(reason: string): never {
  incrementSearchesWithUnresponsiveEnginesSinceLastRestart();
  throw new Error(
    `No results returned from SearXNG. Unresponsive engines: ${reason}`,
  );
}

async function performSearch(
  query: string,
  searchType: SearchType,
): Promise<SearxngSearchResult[]> {
  const searchUrl = buildSearchUrl(query, searchType);

  let retryReason = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_RETRY_DELAY * 2 ** (attempt - 1);
      printMessage(
        `SearXNG ${retryReason}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const response = await fetch(searchUrl, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      if (response.status === 500 && attempt < MAX_RETRIES) {
        retryReason = "returned 500";
        continue;
      }
      throw new Error(`SearXNG request failed with status ${response.status}`);
    }

    const data = (await response.json()) as SearxngSearchResponse;
    const results = Array.isArray(data.results) ? data.results : [];

    if (results.length === 0) {
      const reason = describeUnresponsiveEngines(data.unresponsive_engines);

      // SearXNG answers 200 with an empty result set when its engines are
      // rate-limited, suspended or CAPTCHA-challenged, so the only sign that
      // the search layer is down arrives in `unresponsive_engines`. Returned as
      // an empty array it is indistinguishable from a query that genuinely
      // matches nothing.
      if (reason) {
        if (allEnginesSuspended(data.unresponsive_engines)) {
          failWithUnresponsiveEngines(reason);
        }

        if (attempt < MAX_RETRIES) {
          retryReason = `returned no results (${reason})`;
          continue;
        }

        failWithUnresponsiveEngines(reason);
      }

      incrementSearchesWithoutResultsSinceLastRestart();
      printMessage(
        "No results returned from SearXNG. No engine errors were reported; all engines returned zero results.",
      );
    }

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
) {
  const results = await breaker.execute("searxng", () =>
    performSearch(query, searchType),
  );
  const consideredResults = deduplicateResults(results).slice(0, limit);

  if (searchType === "text") {
    const textualResults = await Promise.all(
      consideredResults.map(processTextualResult),
    );
    return reportDiscardedResults(
      filterNullResults(textualResults),
      consideredResults.length,
      searchType,
    );
  }

  const graphicalResults = await Promise.all(
    consideredResults.map(processGraphicalResult),
  );
  return reportDiscardedResults(
    filterNullResults(graphicalResults),
    consideredResults.length,
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

export async function fetchSearXNG(
  query: string,
  searchType: SearchType,
  limit = 30,
  breaker: CircuitBreaker = searxngCircuitBreaker,
) {
  try {
    return await processSearchResults(query, searchType, limit, breaker);
  } catch (error) {
    // Upstream failure (bad status, network error, malformed body, open
    // circuit) propagates so the endpoint can answer non-200; an empty array
    // then means exactly one thing: zero results.
    const errorMessage = error instanceof Error ? error.message : String(error);
    printMessage(`Search failed: ${errorMessage}`);
    throw error;
  }
}

async function processGraphicalResult(result: SearxngSearchResult) {
  const thumbnailSource =
    result.category === "videos" ? result.thumbnail : result.thumbnail_src;

  const sourceUrl =
    result.category === "videos"
      ? result.iframe_src || result.url
      : result.img_src;

  try {
    return [result.title, result.url, thumbnailSource, sourceUrl] as [
      title: string,
      url: string,
      thumbnailSource: string,
      sourceUrl: string,
    ];
  } catch (error) {
    console.warn(
      `Failed to process ${result.category} result: ${result.url}`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
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

function deduplicateResults(
  results: SearxngSearchResult[],
): SearxngSearchResult[] {
  const urls = new Set<string>();
  return results.filter((result) => {
    if (urls.has(result.url)) return false;
    urls.add(result.url);
    return true;
  });
}

function filterNullResults<T>(results: (T | null)[]): T[] {
  return results.filter((result): result is T => result !== null);
}
