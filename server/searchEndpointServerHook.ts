import axios from "axios";
import type { PreviewServer, ViteDevServer } from "vite";
import { fetchSearXNG } from "./fetchSearXNG";
import { rankSearchResults } from "./rankSearchResults";
import {
  incrementGraphicalSearchesSinceLastRestart,
  incrementTextualSearchesSinceLastRestart,
} from "./searchesSinceLastRestart";
import { verifyTokenAndRateLimit } from "./verifyTokenAndRateLimit";

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
      response.end(JSON.stringify({ error: "Missing query parameter" }));
      return;
    }

    const { isAuthorized, statusCode, error } =
      await verifyTokenAndRateLimit(token);
    if (!isAuthorized && statusCode && error) {
      response.statusCode = statusCode;
      response.end(JSON.stringify({ error }));
      return;
    }

    try {
      const isTextSearch = request.url?.startsWith("/search/text");
      const searchType = isTextSearch ? "text" : "images";
      const searxngResults = await fetchSearXNG(query, searchType, limit);

      if (isTextSearch) {
        const results = searxngResults as TextResult[];
        const rankedResults = await rankSearchResults(query, results, true);

        incrementTextualSearchesSinceLastRestart();

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(rankedResults));
      } else {
        const uniqueUrlMap = new Map<string, ImageResult>();
        for (const result of searxngResults as ImageResult[]) {
          const [, url] = result;
          if (!uniqueUrlMap.has(url)) {
            uniqueUrlMap.set(url, result);
          }
        }
        const results = Array.from(uniqueUrlMap.values());

        let rankedResults: [title: string, content: string, url: string][];

        try {
          rankedResults = await rankSearchResults(
            query,
            results.map(
              ([title, url]) =>
                [title.slice(0, 100), "", url.slice(0, 100)] as TextResult,
            ),
          );
        } catch (error) {
          console.error(
            "Error ranking search results:",
            error instanceof Error ? error.message : error,
          );
          rankedResults = results.map(
            ([title]) => [title, "", ""] as TextResult,
          );
        }

        const processedResults = (
          await Promise.all(
            rankedResults.map(async ([title]) => {
              const result = results.find(
                ([resultTitle]) => resultTitle === title,
              );
              if (!result) return null;
              const [_, url, thumbnailSource, sourceUrl] = result;
              try {
                const axiosResponse = await axios.get(thumbnailSource, {
                  responseType: "arraybuffer",
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
      response.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
}
