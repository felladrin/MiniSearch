import axios from "axios";
import type { PreviewServer, ViteDevServer } from "vite";
import { handleTokenVerification } from "./handleTokenVerification";
import { rankSearchResults } from "./rankSearchResults";
import { getRerankerStatus } from "./rerankerService";
import {
  incrementGraphicalSearchesSinceLastRestart,
  incrementTextualSearchesSinceLastRestart,
} from "./searchesSinceLastRestart";
import { fetchSearXNG } from "./webSearchService";

async function handleRanking(
  query: string,
  results: [title: string, content: string, url: string][],
  isTextSearch?: boolean,
): Promise<[title: string, content: string, url: string][]> {
  const isRerankerHealthy = await getRerankerStatus();
  if (!isRerankerHealthy) {
    console.warn("Reranker service is not healthy, using unranked results");
  }

  try {
    if (isRerankerHealthy) {
      return await rankSearchResults(query, results, isTextSearch);
    }
    return results;
  } catch (error) {
    console.error(
      "Error ranking search results:",
      error instanceof Error ? error.message : error,
    );
    return results;
  }
}

type TextResult = [title: string, content: string, url: string];
type ImageResult = [
  title: string,
  url: string,
  thumbnailSource: string,
  sourceUrl: string,
];

export function searchEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/search/")) return next();

    const url = new URL(request.url, `http://${request.headers.host}`);
    const query = url.searchParams.get("q");
    const token = url.searchParams.get("token");
    const limit = Number(url.searchParams.get("limit")) || 30;

    if (!query) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "Missing query parameter" }));
      return;
    }

    const { shouldContinue } = await handleTokenVerification(token, response);

    if (!shouldContinue) return;

    try {
      const isTextSearch = request.url?.startsWith("/search/text");
      const searchType = isTextSearch ? "text" : "images";
      const searxngResults = await fetchSearXNG(query, searchType, limit);

      if (isTextSearch) {
        const results = searxngResults as TextResult[];
        const rankedResults = await handleRanking(query, results, true);

        incrementTextualSearchesSinceLastRestart();

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(rankedResults));
      } else {
        const results = searxngResults as ImageResult[];
        const resultsText = results.map(
          ([title, url]) => [title.slice(0, 100), "", url] as TextResult,
        );
        const rankedResults = await handleRanking(query, resultsText);

        const processedResults = (
          await Promise.all(
            rankedResults.map(async ([title, , rankedResultUrl]) => {
              const result = results.find(
                ([, resultUrl]) => resultUrl === rankedResultUrl,
              );
              if (!result) return null;
              const [_, url, thumbnailSource, sourceUrl] = result;
              try {
                const axiosResponse = await axios.get(thumbnailSource, {
                  responseType: "arraybuffer",
                  timeout: 1000,
                });

                const contentType = axiosResponse.headers["content-type"];
                const base64 = Buffer.from(axiosResponse.data).toString(
                  "base64",
                );

                return [
                  title,
                  url,
                  `data:${contentType};base64,${base64}`,
                  sourceUrl,
                ] as ImageResult;
              } catch {
                return null;
              }
            }),
          )
        ).filter((result): result is ImageResult => result !== null);

        incrementGraphicalSearchesSinceLastRestart();

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(processedResults));
      }
    } catch (error) {
      console.error(
        "Error processing search:",
        error instanceof Error ? error.message : error,
      );
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
}
