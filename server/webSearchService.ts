import { basename } from "node:path";
import debug from "debug";
import { convert as convertHtmlToPlainText } from "html-to-text";
import { strip as stripEmojis } from "node-emoji";

const fileName = basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

const SERVICE_HOST = "127.0.0.1";
const SERVICE_PORT = 8888;
const SERVICE_BASE_URL = `http://${SERVICE_HOST}:${SERVICE_PORT}`;

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  isOpen: boolean;
}

const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  isOpen: false,
};

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 60000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000;

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

export async function getWebSearchStatus() {
  try {
    const response = await fetch(`${SERVICE_BASE_URL}/healthz`);
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

function recordFailure() {
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = Date.now();
  if (circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.isOpen = true;
    printMessage(
      `Circuit breaker opened after ${circuitBreaker.failures} failures`,
    );
  }
}

async function performSearch(
  query: string,
  searchType: SearchType,
): Promise<SearxngSearchResult[]> {
  if (circuitBreaker.isOpen) {
    const timeSinceLastFailure = Date.now() - circuitBreaker.lastFailureTime;
    if (timeSinceLastFailure < CIRCUIT_BREAKER_TIMEOUT) {
      throw new Error(
        "Circuit breaker is open - SearXNG service temporarily unavailable",
      );
    }
    circuitBreaker.isOpen = false;
    circuitBreaker.failures = 0;
    printMessage("Circuit breaker reset");
  }

  const searchUrl = buildSearchUrl(query, searchType);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_RETRY_DELAY * 2 ** (attempt - 1);
      printMessage(
        `SearXNG returned 500, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const response = await fetch(searchUrl, {
      headers: { Accept: "application/json" },
    }).catch((error: unknown) => {
      recordFailure();
      throw error;
    });

    if (!response.ok) {
      if (response.status === 500 && attempt < MAX_RETRIES) {
        continue;
      }
      recordFailure();
      throw new Error(`SearXNG request failed with status ${response.status}`);
    }

    circuitBreaker.failures = 0;
    circuitBreaker.isOpen = false;

    const data = (await response.json()) as SearxngSearchResponse;
    const results = Array.isArray(data.results) ? data.results : [];

    if (results.length === 0) {
      const reason = describeUnresponsiveEngines(data.unresponsive_engines);
      printMessage(
        reason
          ? `No results returned from SearXNG for query: ${query}. Unresponsive engines: ${reason}`
          : `No results returned from SearXNG for query: ${query}. No engine errors were reported; all engines returned zero results.`,
      );
    }

    return results;
  }

  recordFailure();
  throw new Error(
    `SearXNG request failed with status 500 after ${MAX_RETRIES} retries`,
  );
}

async function processSearchResults(
  query: string,
  searchType: SearchType,
  limit: number,
) {
  const results = await performSearch(query, searchType);
  const deduplicatedResults = deduplicateResults(results);

  if (searchType === "text") {
    const textualResults = await Promise.all(
      deduplicatedResults.slice(0, limit).map(processTextualResult),
    );
    return reportDiscardedResults(
      filterNullResults(textualResults),
      results.length,
      query,
      searchType,
    );
  }

  const graphicalResults = await Promise.all(
    deduplicatedResults.slice(0, limit).map(processGraphicalResult),
  );
  return reportDiscardedResults(
    filterNullResults(graphicalResults),
    results.length,
    query,
    searchType,
  );
}

/**
 * Logs when SearXNG returned results but every one was dropped during processing
 * (e.g. missing title, snippet, or media source). Without this, the discarded
 * batch surfaces to the user as an opaque "Search failed" with no server-side
 * trace of why the non-empty response yielded nothing usable.
 */
function reportDiscardedResults<T>(
  filteredResults: T[],
  rawResultCount: number,
  query: string,
  searchType: SearchType,
): T[] {
  if (rawResultCount > 0 && filteredResults.length === 0) {
    printMessage(
      `All ${rawResultCount} ${searchType} result(s) from SearXNG for query: ${query} were discarded during processing (missing title, snippet, or media source).`,
    );
  }
  return filteredResults;
}

export async function fetchSearXNG(
  query: string,
  searchType: SearchType,
  limit = 30,
) {
  try {
    return await processSearchResults(query, searchType, limit);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    printMessage(`Search failed: ${errorMessage}`);
    return [];
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
