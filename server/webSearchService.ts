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

async function testSearch(): Promise<boolean> {
  try {
    const results = await performSearch("test", "text");
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
    const response = await fetch(`${SERVICE_BASE_URL}/healthz`);
    const responseText = await response.text();
    if (responseText.trim() !== "OK") return false;

    return await testSearch();
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

async function performSearch(query: string, searchType: SearchType) {
  const searchUrl = buildSearchUrl(query, searchType);
  const response = await fetch(searchUrl, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`SearXNG request failed with status ${response.status}`);
  }

  const data = (await response.json()) as SearxngSearchResponse;
  return Array.isArray(data.results) ? data.results : [];
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
    return filterNullResults(textualResults);
  }

  const graphicalResults = await Promise.all(
    deduplicatedResults.slice(0, limit).map(processGraphicalResult),
  );
  return filterNullResults(graphicalResults);
}

export async function fetchSearXNG(
  query: string,
  searchType: SearchType,
  limit = 30,
) {
  try {
    return await processSearchResults(query, searchType, limit);
  } catch (error) {
    printMessage(
      `Search failed`,
      error instanceof Error ? error.message : error,
    );
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
