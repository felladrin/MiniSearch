import { basename } from "node:path";
import debug from "debug";
import { convert as convertHtmlToPlainText } from "html-to-text";
import { strip as stripEmojis } from "node-emoji";
import { type SearxngSearchResult, SearxngService } from "searxng";

const fileName = basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

const SERVICE_HOST = "127.0.0.1";
const SERVICE_PORT = 8888;

let searxng = new SearxngService({
  baseURL: `http://${SERVICE_HOST}:${SERVICE_PORT}`,
  defaultSearchParams: {
    lang: "auto",
    safesearch: 1,
    format: "json",
  },
});

let reinitializePromise: Promise<void> | null = null;

function reinitializeService() {
  if (reinitializePromise) return reinitializePromise;

  reinitializePromise = (async () => {
    try {
      printMessage("Reinitializing service...");
      searxng = new SearxngService({
        baseURL: `http://${SERVICE_HOST}:${SERVICE_PORT}`,
        defaultSearchParams: {
          lang: "auto",
          safesearch: 1,
          format: "json",
        },
      });
      printMessage("Service reinitialized!");
    } finally {
      reinitializePromise = null;
    }
  })();

  return reinitializePromise;
}

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

async function testSearch(): Promise<boolean> {
  try {
    const { results } = await searxng.search("test", {
      categories: ["general"],
    });
    return Array.isArray(results) && results.length > 0;
  } catch (error) {
    printMessage(
      "Test search failed:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export async function getWebSearchStatus() {
  try {
    const response = await fetch(
      `http://${SERVICE_HOST}:${SERVICE_PORT}/healthz`,
    );
    const responseText = await response.text();
    if (responseText.trim() !== "OK") return false;

    return await testSearch();
  } catch {
    return false;
  }
}

async function performSearch(query: string, searchType: "text" | "images") {
  if (searchType === "text") {
    return await searxng.search(query, {
      categories: ["general"],
    });
  }

  return await searxng.search(query, {
    categories: ["images", "videos"],
  });
}

async function processSearchResults(
  query: string,
  searchType: "text" | "images",
  limit: number,
) {
  const { results } = await performSearch(query, searchType);
  const deduplicatedResults = deduplicateResults(results);

  if (searchType === "text") {
    const textualResults = await Promise.all(
      deduplicatedResults.slice(0, limit).map(processTextualResult),
    );
    return filterNullResults(textualResults);
  }

  const graphicalResults = await Promise.all(
    deduplicatedResults.slice(0, limit).map(processGraphicalResult),
  );
  return filterNullResults(graphicalResults);
}

export async function fetchSearXNG(
  query: string,
  searchType: "text" | "images",
  limit = 30,
) {
  try {
    return await processSearchResults(query, searchType, limit);
  } catch (error) {
    printMessage(
      `Search failed, reinitializing service...`,
      error instanceof Error ? error.message : error,
    );

    await reinitializeService();

    try {
      return await processSearchResults(query, searchType, limit);
    } catch (retryError) {
      printMessage(
        "Error fetching search results after retry:",
        retryError instanceof Error ? retryError.message : retryError,
      );
      return [];
    }
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
  return results.filter(
    (result): result is NonNullable<typeof result> => result !== null,
  );
}
