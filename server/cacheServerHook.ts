import type { PreviewServer, ViteDevServer } from "vite";

export function cacheServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use(async (request, response, next) => {
    let cacheControlValue = "public, max-age=86400, must-revalidate";
    if (request.url.startsWith("/assets/")) {
      cacheControlValue = "public, max-age=31536000, immutable";
    } else if (
      request.url === "/" ||
      request.url.startsWith("/?") ||
      request.url.endsWith(".html")
    ) {
      cacheControlValue = "no-cache";
    }

    response.setHeader("Cache-Control", cacheControlValue);

    next();
  });
}
