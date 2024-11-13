import { convert as convertHtmlToPlainText } from "html-to-text";
import { strip as stripEmojis } from "node-emoji";
import { type SearxngSearchResult, SearxngService } from "searxng";

const searxng = new SearxngService({
  baseURL: "http://127.0.0.1:8080",
  defaultSearchParams: {
    lang: "auto",
    safesearch: 1,
    format: "json",
    categories: ["general", "images", "videos"],
  },
});

export async function fetchSearXNG(query: string, limit = 30) {
  try {
    const resultsResponse = await searxng.search(query);

    const [graphicalResults, textualResults] = await Promise.all([
      Promise.all(
        resultsResponse.results
          .filter(
            (result) =>
              result.category === "images" || result.category === "videos",
          )
          .slice(0, limit)
          .map(processGraphicalResult),
      ),
      Promise.all(
        resultsResponse.results
          .filter(
            (result) =>
              result.category !== "images" && result.category !== "videos",
          )
          .slice(0, limit)
          .map(processTextualResult),
      ),
    ]);

    return {
      textResults: textualResults.filter(
        (result): result is NonNullable<typeof result> => result !== null,
      ),
      imageResults: graphicalResults.filter(
        (result): result is NonNullable<typeof result> => result !== null,
      ),
    };
  } catch (error) {
    console.error(
      "Error fetching search results:",
      error instanceof Error ? error.message : error,
    );
    return { textResults: [], imageResults: [] };
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
