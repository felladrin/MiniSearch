import prettyMilliseconds from "pretty-ms";
import type { PreviewServer, ViteDevServer } from "vite";
import { getAuthorizationStats } from "./authorizationSinceLastRestart.ts";
import { getInferenceStats } from "./inferencesSinceLastRestart.ts";
import { getPageReadStats } from "./pageReadsSinceLastRestart.ts";
import { getRerankerStatus } from "./rerankerService.ts";
import {
  getGraphicalSearchesSinceLastRestart,
  getSearchesWithAllResultsDiscardedSinceLastRestart,
  getSearchesWithoutResultsSinceLastRestart,
  getSearchesWithUnresponsiveEnginesSinceLastRestart,
  getTextualSearchesSinceLastRestart,
} from "./searchesSinceLastRestart.ts";
import { getVerifiedTokensAmount } from "./verifiedTokens.ts";
import { getWebSearchStatus } from "./webSearchService.ts";

const serverStartTime = Date.now();

/** Serves `/status`: uptime, search and request counters, and the health of the reranker and SearXNG. */
export function statusEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/status")) return next();

    const sessions = getVerifiedTokensAmount();
    const textualSearches = getTextualSearchesSinceLastRestart();
    const graphicalSearches = getGraphicalSearchesSinceLastRestart();
    const averageTextualSearchesPerSession = Number(
      (textualSearches / sessions || 0).toFixed(1),
    );
    const averageGraphicalSearchesPerSession = Number(
      (graphicalSearches / sessions || 0).toFixed(1),
    );
    const rerankerServiceStatus = (await getRerankerStatus())
      ? "healthy"
      : "unhealthy";
    const webSearchServiceStatus = (await getWebSearchStatus())
      ? "healthy"
      : "unhealthy";

    // `vite.config.ts` sets this define with `JSON.stringify`, so in a Vite
    // build it is always a valid JSON string literal; the guard only fires if
    // a non-Vite consumer sets it to something malformed.
    let gitCommit: string;
    try {
      gitCommit = JSON.parse(
        server.config.define?.VITE_COMMIT_SHORT_HASH || '""',
      );
    } catch {
      throw new Error("Malformed VITE_COMMIT_SHORT_HASH build define");
    }

    const status = {
      uptime: prettyMilliseconds(Date.now() - serverStartTime, {
        verbose: true,
      }),
      sessions,
      textualSearches,
      graphicalSearches,
      averageTextualSearchesPerSession,
      averageGraphicalSearchesPerSession,
      searchesWithoutResults: getSearchesWithoutResultsSinceLastRestart(),
      searchesWithUnresponsiveEngines:
        getSearchesWithUnresponsiveEnginesSinceLastRestart(),
      searchesWithAllResultsDiscarded:
        getSearchesWithAllResultsDiscardedSinceLastRestart(),
      rerankerServiceStatus,
      webSearchServiceStatus,
      pageReads: getPageReadStats(),
      authorization: getAuthorizationStats(),
      inference: getInferenceStats(),
      build: {
        timestamp: new Date(
          server.config.define?.VITE_BUILD_DATE_TIME || "",
        ).toISOString(),
        gitCommit,
      },
    };

    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(status));
  });
}
