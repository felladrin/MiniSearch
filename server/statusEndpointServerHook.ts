import prettyMilliseconds from "pretty-ms";
import type { PreviewServer, ViteDevServer } from "vite";
import { getRerankerStatus } from "./rerankerService";
import {
  getGraphicalSearchesSinceLastRestart,
  getTextualSearchesSinceLastRestart,
} from "./searchesSinceLastRestart";
import { getVerifiedTokensAmount } from "./verifiedTokens";

const serverStartTime = new Date().getTime();

export function statusEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith("/status")) return next();

    const sessions = getVerifiedTokensAmount();
    const textualSearches = getTextualSearchesSinceLastRestart();
    const graphicalSearches = getGraphicalSearchesSinceLastRestart();
    const averageTextualSearchesPerSession = (
      textualSearches / sessions || 0
    ).toFixed(1);
    const averageGraphicalSearchesPerSession = (
      graphicalSearches / sessions || 0
    ).toFixed(1);
    const rerankerServiceStatus = (await getRerankerStatus())
      ? "healthy"
      : "unhealthy";

    const status = {
      uptime: prettyMilliseconds(new Date().getTime() - serverStartTime, {
        verbose: true,
      }),
      sessions,
      textualSearches,
      graphicalSearches,
      averageTextualSearchesPerSession,
      averageGraphicalSearchesPerSession,
      rerankerServiceStatus,
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
