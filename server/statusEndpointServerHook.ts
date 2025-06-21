import prettyMilliseconds from "pretty-ms";
import type { PreviewServer, ViteDevServer } from "vite";
import { getRerankerStatus } from "./rerankerService";
import {
  getGraphicalSearchesSinceLastRestart,
  getTextualSearchesSinceLastRestart,
} from "./searchesSinceLastRestart";
import { getVerifiedTokensAmount } from "./verifiedTokens";
import { getWebSearchStatus } from "./webSearchService";

const serverStartTime = Date.now();

export function statusEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith("/status")) return next();

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

    const status = {
      uptime: prettyMilliseconds(Date.now() - serverStartTime, {
        verbose: true,
      }),
      sessions,
      textualSearches,
      graphicalSearches,
      averageTextualSearchesPerSession,
      averageGraphicalSearchesPerSession,
      rerankerServiceStatus,
      webSearchServiceStatus,
      build: {
        timestamp: new Date(
          server.config.define.VITE_BUILD_DATE_TIME,
        ).toISOString(),
        gitCommit: JSON.parse(server.config.define.VITE_COMMIT_SHORT_HASH),
      },
    };

    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(status));
  });
}
