import axios from "axios";
import type { PreviewServer, ViteDevServer } from "vite";
import { fetchSearXNG } from "./fetchSearXNG";
import { rankSearchResults } from "./rankSearchResults";
import { incrementSearchesSinceLastRestart } from "./searchesSinceLastRestart";
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

    incrementSearchesSinceLastRestart();

    try {
      const isTextSearch = request.url?.startsWith("/search/text");
      const searchType = isTextSearch ? "text" : "images";
      const searxResults = await fetchSearXNG(query, searchType, limit);

      if (isTextSearch) {
        const results = searxResults as TextResult[];
        const rankedResults = await rankSearchResults(query, results);

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(rankedResults));
      } else {
        const results = searxResults as ImageResult[];
        const rankedResults = await rankSearchResults(
          query,
          results.map(
            ([title, url, , sourceUrl]) =>
              [
                title.slice(0, 100),
                sourceUrl.slice(0, 100),
                url.slice(0, 100),
              ] as TextResult,
          ),
        );

        const processedResults = (
          await Promise.all(
            results
              .filter((_, index) =>
                rankedResults.some(([title]) => title === results[index][0]),
              )
              .map(async ([title, url, thumbnailSource, sourceUrl]) => {
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
