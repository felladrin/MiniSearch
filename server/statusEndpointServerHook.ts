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

    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        uptime: prettyMilliseconds(new Date().getTime() - serverStartTime, {
          compact: true,
          verbose: true,
        }),
        sessions: getVerifiedTokensAmount(),
        searches: getSearchesSinceLastRestart(),
      }),
    );
  });
}
