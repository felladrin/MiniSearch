import axios from "axios";
import type { PreviewServer, ViteDevServer } from "vite";
import { fetchSearXNG } from "./fetchSearXNG";
import { rankSearchResults } from "./rankSearchResults";
import { incrementSearchesSinceLastRestart } from "./searchesSinceLastRestart";
import { verifyTokenAndRateLimit } from "./verifyTokenAndRateLimit";

export function searchEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith("/search")) return next();

    const { searchParams } = new URL(
      request.url,
      `http://${request.headers.host}`,
    );

    const limitParam = searchParams.get("limit");
    const limit =
      limitParam && Number(limitParam) > 0 ? Number(limitParam) : undefined;
    const query = searchParams.get("q");

    if (!query) {
      response.statusCode = 400;
      response.end("Missing the query parameter.");
      return;
    }

    const token = searchParams.get("token");
    const authResult = await verifyTokenAndRateLimit(token);

    if (!authResult.isAuthorized) {
      response.statusCode = authResult.statusCode;
      response.end(authResult.error);
      return;
    }

    const { textResults, imageResults } = await fetchSearXNG(query, limit);

    incrementSearchesSinceLastRestart();

    if (textResults.length === 0 && imageResults.length === 0) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ textResults: [], imageResults: [] }));
      return;
    }

    try {
      const rankedTextResults = await rankSearchResults(query, textResults);

      const rankedImageResults = await rankSearchResults(
        query,
        imageResults.map(([title, url, , sourceUrl]) => [
          title.slice(0, 100),
          sourceUrl.slice(0, 100),
          url.slice(0, 100),
        ]),
      );

      const processedImageResults = await Promise.all(
        imageResults
          .filter((_, index) =>
            rankedImageResults.some(
              ([title]) => title === imageResults[index][0],
            ),
          )
          .map(async ([title, url, thumbnailSource, sourceUrl]) => {
            try {
              const axiosResponse = await axios.get(thumbnailSource, {
                responseType: "arraybuffer",
              });

              const contentType = axiosResponse.headers["content-type"];
              const base64 = Buffer.from(axiosResponse.data).toString("base64");
              const thumbnailUrl = `data:${contentType};base64,${base64}`;

              return [title, url, thumbnailUrl, sourceUrl];
            } catch {
              return null;
            }
          }),
      );

      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          textResults: rankedTextResults,
          imageResults: processedImageResults.filter(Boolean),
        }),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Error ranking search results: ${errorMessage}`);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ textResults, imageResults: [] }));
    }
  });
}
