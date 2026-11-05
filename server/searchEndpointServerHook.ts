import type { PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import {
  assertSearchFallbackConfiguration,
  fetchFallbackTextResults,
  isSearchFallbackEnabled,
} from "./fallbackSearchService.ts";
import { handleTokenVerification } from "./handleTokenVerification.ts";
import {
  isOfficialLaneEnabled,
  mergeOfficialLaneResults,
  officialLaneRequest,
} from "./officialLane.ts";
import { rankSearchResults } from "./rankSearchResults.ts";
import { getRerankerStatus } from "./rerankerService.ts";
import {
  recordRerankFailed,
  recordRerankSkipped,
} from "./rerankingSinceLastRestart.ts";
import {
  addOfficialLaneResults,
  incrementGraphicalSearchesSinceLastRestart,
  incrementOfficialLaneFailures,
  incrementOfficialLaneSearches,
  incrementSearchesFailedOnFallback,
  incrementSearchesServedByFallback,
  incrementTextualSearchesSinceLastRestart,
  recordSearchDuration,
  type SearchType,
} from "./searchesSinceLastRestart.ts";
import { sendValidationError } from "./utils/httpResponse.ts";
import { fetchSearXNG, fetchSupplementarySearXNG } from "./webSearchService.ts";

const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 30;
const MAX_QUERY_LENGTH = 2000;
// The client aborts a search after REQUEST_TIMEOUT in client/modules/search.ts
// (30 s) and shows its timeout alert, so a response still being assembled when
// that lands is a response the user never sees. The fallback may not push a
// search past this point; the 5 s margin is for ranking and the transfer.
const SEARCH_DEADLINE_MS = 25_000;
// A fallback cannot finish in this window, so starting one would only move the
// same 502 further out.
const MIN_FALLBACK_BUDGET_MS = 2_000;

// The official lane is a supplement for a search that already succeeded, so it
// never gets the last seconds of the deadline: what it would add is not worth
// risking a response the client is still waiting for.
const OFFICIAL_LANE_RESERVED_MS = 5_000;

// The lane is a supplement to a search that already has results, so it gets a
// slice of the deadline rather than the rest of it: the ranking still has to
// run, and a search that waits on a second upstream for the full 25 seconds is
// slower than the page it was meant to improve.
const MAX_OFFICIAL_LANE_TIMEOUT_MS = 8_000;

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
  searchType: SearchType,
  results: [title: string, content: string, url: string][],
  preserveTopResults = false,
): Promise<[title: string, content: string, url: string, score?: number][]> {
  const isRerankerHealthy = await getRerankerStatus();
  if (!isRerankerHealthy) {
    recordRerankSkipped();
    console.warn("Reranker service is not healthy, using unranked results");
  }

  try {
    if (isRerankerHealthy) {
      return await rankSearchResults(
        query,
        searchType,
        results,
        preserveTopResults,
      );
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
 * Adds the pages a scoped second query finds, when the request asks for it and
 * the deadline still has room. Every failure here is the search it already has:
 * the lane never turns a served search into a 502, and a domain that cannot be
 * scoped confidently leaves the results untouched.
 */
async function officialLaneResults(
  query: string,
  results: TextResult[],
  limit: number,
  remainingMs: number,
): Promise<TextResult[]> {
  const budgetMs = Math.min(
    MAX_OFFICIAL_LANE_TIMEOUT_MS,
    remainingMs - OFFICIAL_LANE_RESERVED_MS,
  );
  if (budgetMs <= 0) return results;

  const lane = officialLaneRequest(query, results);
  if (!lane) return results;

  incrementOfficialLaneSearches();

  try {
    // The signal cancels the request itself, so a lane that runs out of time
    // stops using the engines instead of finishing for nobody.
    const laneResults = await fetchSupplementarySearXNG(
      lane.query,
      limit,
      AbortSignal.timeout(budgetMs),
    );

    const merged = mergeOfficialLaneResults(results, laneResults, lane.domain);

    const added = merged.length - results.length;
    if (added > 0) addOfficialLaneResults(added);

    return merged;
  } catch (error) {
    incrementOfficialLaneFailures();
    // The domain is left out: it is derived from the query, and the failure
    // count is the fact anyone acts on.
    console.error(
      `Official lane search failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
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
  // At registration rather than per search: a misconfigured fallback has to
  // stop the server at start, not surface as a 502 during the next outage.
  if (isSearchFallbackEnabled()) assertSearchFallbackConfiguration();

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
      sendValidationError(response, parsedParams.error);
      return;
    }

    const { query, limit } = parsedParams.data;

    try {
      const isTextSearch = request.url?.startsWith("/search/text");
      const searchType = isTextSearch ? "text" : "images";

      let searchResults: TextResult[] | ImageResult[] | null;
      let servedBySearXNG = false;
      const searchStartedAt = performance.now();
      try {
        searchResults = await fetchSearXNG(query, searchType, limit);
        servedBySearXNG = true;
        recordSearchDuration(searchType, performance.now() - searchStartedAt);
      } catch {
        // SearXNG is unreachable. The operator may have switched on a second
        // text source, which is consulted only here, after SearXNG has failed,
        // and never for images: no fallback provider has image search.
        searchResults = null;

        if (isTextSearch && isSearchFallbackEnabled()) {
          const remainingMs =
            SEARCH_DEADLINE_MS - (performance.now() - searchStartedAt);

          if (remainingMs < MIN_FALLBACK_BUDGET_MS) {
            // The deadline leaves too little time for a second source, so it is
            // not asked and the 502 goes out now. Counted as a fallback that
            // failed rather than one that served, since none of its results
            // could have reached the client in time.
            incrementSearchesFailedOnFallback();
            console.error(
              "SearXNG failed, and the search deadline left the fallback too little time",
            );
          } else {
            try {
              searchResults = await fetchFallbackTextResults(
                query,
                limit,
                remainingMs,
              );
              incrementSearchesServedByFallback();
              console.log(
                "SearXNG failed, served text results from the fallback search",
              );
            } catch (fallbackError) {
              incrementSearchesFailedOnFallback();
              // Fixed text plus the error's message, which by construction
              // carries an HTTP status or a JSON-RPC code, never the query.
              console.error(
                `SearXNG failed, and the fallback search failed: ${
                  fallbackError instanceof Error
                    ? fallbackError.message
                    : String(fallbackError)
                }`,
              );
            }
          }
        }
      }

      if (searchResults === null) {
        // The fallback is off, is not offered for this search type, was skipped
        // for lack of deadline, or failed itself: answer non-200 so the client
        // can tell an outage apart from a search that genuinely has no results.
        response.statusCode = 502;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "Search service unavailable" }));
        return;
      }

      if (isTextSearch) {
        let results = searchResults as TextResult[];

        // Results from the fallback mean SearXNG has just failed, so a second
        // request to it would only add latency to a search that is already slow.
        if (servedBySearXNG && isOfficialLaneEnabled()) {
          const remainingMs =
            SEARCH_DEADLINE_MS - (performance.now() - searchStartedAt);

          results = await officialLaneResults(
            query,
            results,
            limit,
            remainingMs,
          );
        }

        const rankedResults = await handleRanking(
          query,
          searchType,
          results,
          true,
        );

        incrementTextualSearchesSinceLastRestart();

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(rankedResults));
      } else {
        const results = searchResults as ImageResult[];
        const resultsText = results.map(
          ([title, url]) => [title?.slice(0, 100) || "", "", url] as TextResult,
        );
        const rankedResults = await handleRanking(
          query,
          searchType,
          resultsText,
        );

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
