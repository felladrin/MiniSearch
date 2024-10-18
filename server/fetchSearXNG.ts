import { convert as convertHtmlToPlainText } from "html-to-text";
import { strip as stripEmojis } from "node-emoji";
import { SearxngSearchResult, SearxngService } from "searxng";
import axios from "axios";

const searxng = new SearxngService({
  baseURL: "http://127.0.0.1:8080",
  defaultSearchParams: {
    lang: "auto",
    safesearch: 1,
    format: "json",
    categories: ["web"],
  },
});

export async function fetchSearXNG(query: string, limit?: number) {
  try {
    const resultsResponse = await searxng.search(query);

    let graphicalSearchResults: SearxngSearchResult[] = [];
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

    if (limit && limit > 0) {
      graphicalSearchResults = graphicalSearchResults.slice(0, limit);
    }

    let textResults: [title: string, content: string, url: string][] = [];
    const imageResults: [
      title: string,
      url: string,
      thumbnailUrl: string,
      sourceUrl: string,
    ][] = [];

    const uniqueHostnames = new Set<string>();
    const uniqueSourceUrls = new Set<string>();

    const processSnippet = (snippet: string): string => {
      if (snippet.startsWith("[data:image")) return "";

      return stripEmojis(
        convertHtmlToPlainText(snippet, { wordwrap: false }).trim(),
        { preserveSpaces: true },
      );
    };

    const imagePromises = graphicalSearchResults.map(async (result) => {
      const thumbnailSource =
        result.category === "videos" ? result.thumbnail : result.thumbnail_src;

      let thumbnailSourceIsValid = true;

      try {
        new URL(thumbnailSource);
      } catch {
        thumbnailSourceIsValid = false;
      }

      if (thumbnailSourceIsValid) {
        try {
          const axiosResponse = await axios.get(thumbnailSource, {
            responseType: "arraybuffer",
          });

          const contentType = axiosResponse.headers["content-type"];
          const base64 = Buffer.from(axiosResponse.data).toString("base64");
          const thumbnailUrl = `data:${contentType};base64,${base64}`;

          if (result.category === "videos") {
            return [
              result.title,
              result.url,
              thumbnailUrl,
              result.iframe_src || result.url,
            ];
          } else {
            return [result.title, result.url, thumbnailUrl, result.img_src];
          }
        } catch {
          return null;
        }
      }

      return null;
    });

    const resolvedImageResults = await Promise.all(imagePromises);
    imageResults.push(
      ...resolvedImageResults
        .filter(
          (result): result is [string, string, string, string] =>
            result !== null && !uniqueSourceUrls.has(result[3]),
        )
        .map((result) => {
          uniqueSourceUrls.add(result[3]);
          return result;
        }),
    );

    textualSearchResults.forEach((result) => {
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
    });

    if (limit && limit > 0) {
      textResults = textResults.slice(0, limit);
    }

    return { textResults, imageResults };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error fetching search results: ${errorMessage}`);
    return { textResults: [], imageResults: [] };
  }
}
