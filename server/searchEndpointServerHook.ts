import type { PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import { handleTokenVerification } from "./handleTokenVerification.ts";
import { rankSearchResults } from "./rankSearchResults.ts";
import { getRerankerStatus } from "./rerankerService.ts";
import {
  recordRerankFailed,
  recordRerankSkipped,
} from "./rerankingSinceLastRestart.ts";
import {
  incrementGraphicalSearchesSinceLastRestart,
  incrementTextualSearchesSinceLastRestart,
  recordSearchDuration,
} from "./searchesSinceLastRestart.ts";
import { fetchSearXNG } from "./webSearchService.ts";

const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 30;
const MAX_QUERY_LENGTH = 2000;

const searchParamsSchema = z.object({
  query: z
    .string({ error: "Missing query parameter" })
    .trim()
    .min(1, "Missing query parameter")
    .max(
      MAX_QUERY_LENGTH,
      `Query parameter must not exceed ${MAX_QUERY_LENGTH} characters`,
    ),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .catch(DEFAULT_SEARCH_LIMIT)
    .transform((limit) => Math.min(limit, MAX_SEARCH_LIMIT)),
});

type TextResult = [title: string, content: string, url: string];
type ImageResult = [
  title: string,
  url: string,
  thumbnailSource: string,
  sourceUrl: string,
];

async function handleRanking(
  query: string,
  results: [title: string, content: string, url: string][],
  isTextSearch?: boolean,
): Promise<[title: string, content: string, url: string, score?: number][]> {
  const isRerankerHealthy = await getRerankerStatus();
  if (!isRerankerHealthy) {
    recordRerankSkipped();
    console.warn("Reranker service is not healthy, using unranked results");
  }

  try {
    if (isRerankerHealthy) {
      return await rankSearchResults(query, results, isTextSearch);
    }
    return results;
  } catch (error) {
    recordRerankFailed();
    console.error(
      "Error ranking search results:",
      error instanceof Error ? error.message : error,
    );
    return results;
  }
}

/**
 * Serves `/search/text` and `/search/images`: verified requests go through
 * SearXNG, with reranking and score filtering. Image results carry the
 * thumbnail URL as SearXNG returned it; the client loads each one from
 * `/thumbnail`, so the response does not wait on any thumbnail host.
 */
export function searchEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/search/")) return next();

    const url = new URL(request.url, `http://${request.headers.host}`);

    // Verified before the parameters are read, matching `/page-content`: a
    // malformed query from an unauthenticated caller has to cost the caller a
    // rate-limit point, and it has to be counted, rather than leaving on a 400
    // that never reached the limiter.
    const { shouldContinue } = await handleTokenVerification(
      url.searchParams.get("token"),
      response,
      request,
    );

    if (!shouldContinue) return;

    const parsedParams = searchParamsSchema.safeParse({
      query: url.searchParams.get("q") ?? undefined,
      limit: url.searchParams.get("limit") ?? DEFAULT_SEARCH_LIMIT,
    });

    if (!parsedParams.success) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ error: parsedParams.error.issues[0].message }),
      );
      return;
    }

    const { query, limit } = parsedParams.data;

    try {
      const isTextSearch = request.url?.startsWith("/search/text");
      const searchType = isTextSearch ? "text" : "images";

      let searxngResults: TextResult[] | ImageResult[];
      const searchStartedAt = performance.now();
      try {
        searxngResults = await fetchSearXNG(query, searchType, limit);
        recordSearchDuration(searchType, performance.now() - searchStartedAt);
      } catch {
        // SearXNG is unreachable: answer non-200 so the client can tell an
        // outage apart from a search that genuinely has no results.
        response.statusCode = 502;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "Search service unavailable" }));
        return;
      }

      if (isTextSearch) {
        const results = searxngResults as TextResult[];
        const rankedResults = await handleRanking(query, results, true);

        incrementTextualSearchesSinceLastRestart();

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(rankedResults));
      } else {
        const results = searxngResults as ImageResult[];
        const resultsText = results.map(
          ([title, url]) => [title?.slice(0, 100) || "", "", url] as TextResult,
        );
        const rankedResults = await handleRanking(query, resultsText);

        const processedResults = rankedResults
          .map(([title, , rankedResultUrl]) => {
            const result = results.find(
              ([, resultUrl]) => resultUrl === rankedResultUrl,
            );
            if (!result) return null;
            const [, url, thumbnailSource, sourceUrl] = result;
            return [title, url, thumbnailSource, sourceUrl] as ImageResult;
          })
          .filter((result): result is ImageResult => result !== null);

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
