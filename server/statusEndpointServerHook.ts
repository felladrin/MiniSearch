import { PreviewServer, ViteDevServer } from "vite";
import { getSearchesSinceLastRestart } from "./searchesSinceLastRestart";
import { getVerifiedTokensAmount } from "./verifiedTokens";

const serverStartTime = new Date().getTime();

export function statusEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith("/status")) return next();

    const secondsSinceLastRestart = Math.floor(
      (new Date().getTime() - serverStartTime) / 1000,
    );

    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        secondsSinceLastRestart,
        searchesSinceLastRestart: getSearchesSinceLastRestart(),
        tokensVerifiedSinceLastRestart: getVerifiedTokensAmount(),
      }),
    );
  });
}
