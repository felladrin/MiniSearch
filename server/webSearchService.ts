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

const searxng = new SearxngService({
  baseURL: `http://${SERVICE_HOST}:${SERVICE_PORT}`,
  defaultSearchParams: {
    lang: "auto",
    safesearch: 1,
    format: "json",
  },
});

getWebSearchStatus().then((isReady) => {
  if (isReady) {
    printMessage("Service ready!");
  } else {
    printMessage("Service not available!");
  }
});

export async function getWebSearchStatus() {
  try {
    const response = await fetch(
      `http://${SERVICE_HOST}:${SERVICE_PORT}/healthz`,
    );
    const responseText = await response.text();
    return responseText.trim() === "OK";
  } catch {
    return false;
  }
}

export async function fetchSearXNG(
  query: string,
  searchType: "text" | "images",
  limit = 30,
) {
  try {
    if (searchType === "text") {
      const { results } = await searxng.search(query, {
        categories: ["general"],
      });

      const deduplicatedResults = deduplicateResults(results);

      const textualResults = await Promise.all(
        deduplicatedResults.slice(0, limit).map(processTextualResult),
      );

      return filterNullResults(textualResults);
    }

    const { results } = await searxng.search(query, {
      categories: ["images", "videos"],
    });

    const deduplicatedResults = deduplicateResults(results);

    const graphicalResults = await Promise.all(
      deduplicatedResults.slice(0, limit).map(processGraphicalResult),
    );

    return filterNullResults(graphicalResults);
  } catch (error) {
    console.error(
      "Error fetching search results:",
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
  return results.filter(
    (result): result is NonNullable<typeof result> => result !== null,
  );
}
