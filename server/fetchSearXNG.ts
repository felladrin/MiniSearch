import axios from "axios";
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

export async function fetchSearXNG(query: string, limit?: number) {
  try {
    const resultsResponse = await searxng.search(query);

    const graphicalSearchResults: SearxngSearchResult[] = [];
    const textualSearchResults: SearxngSearchResult[] = [];

    const isVideosOrImagesCategory = (category: string): boolean => {
      return category === "images" || category === "videos";
    };

    for (const result of resultsResponse.results) {
      if (isVideosOrImagesCategory(result.category)) {
        graphicalSearchResults.push(result);
      } else {
        textualSearchResults.push(result);
      }
    }

    const textResults: [title: string, content: string, url: string][] = [];
    const imageResults: [
      title: string,
      url: string,
      thumbnailSource: string,
      sourceUrl: string,
    ][] = [];

    const uniqueHostnames = new Set<string>();
    const uniqueSourceUrls = new Set<string>();

    const processSnippet = (snippet: string): string => {
      const processedSnippet = stripEmojis(
        convertHtmlToPlainText(snippet, { wordwrap: false }).trim(),
        { preserveSpaces: true },
      );

      if (processedSnippet.startsWith("[data:image")) return "";

      return processedSnippet;
    };

    for (const result of graphicalSearchResults) {
      const thumbnailSource =
        result.category === "videos" ? result.thumbnail : result.thumbnail_src;

      try {
        new URL(thumbnailSource);
        if (!uniqueSourceUrls.has(result.img_src)) {
          imageResults.push([
            result.title,
            result.url,
            thumbnailSource,
            result.category === "videos"
              ? result.iframe_src || result.url
              : result.img_src,
          ]);
          uniqueSourceUrls.add(result.img_src);

          if (limit && limit > 0 && imageResults.length >= limit) {
            break;
          }
        }
      } catch (error) {
        void error;
      }
    }

    for (const result of textualSearchResults) {
      const { hostname } = new URL(result.url);

      if (!uniqueHostnames.has(hostname) && result.content) {
        const title = convertHtmlToPlainText(result.title, {
          wordwrap: false,
        }).trim();

        const snippet = processSnippet(result.content);

        if (title && snippet) {
          textResults.push([title, snippet, result.url]);
          uniqueHostnames.add(hostname);
        }
      }

      if (limit && limit > 0 && textResults.length >= limit) {
        break;
      }
    }

    return { textResults, imageResults };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error fetching search results: ${errorMessage}`);
    return { textResults: [], imageResults: [] };
  }
}
