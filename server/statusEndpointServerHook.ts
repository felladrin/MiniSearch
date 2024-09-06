import { PreviewServer, ViteDevServer } from "vite";
import { getSearchesSinceLastRestart } from "./searchesSinceLastRestart";
import { getVerifiedTokensAmount } from "./verifiedTokens";
import prettyMilliseconds from "pretty-ms";

const serverStartTime = new Date().getTime();

export function statusEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith("/status")) return next();

    const status = {
      uptime: prettyMilliseconds(new Date().getTime() - serverStartTime, {
        compact: true,
        verbose: true,
      }),
      sessions: getVerifiedTokensAmount(),
      searches: getSearchesSinceLastRestart(),
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
