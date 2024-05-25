import { PreviewServer, ViteDevServer } from "vite";

export function cacheServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use(async (request, response, next) => {
    if (request.url.endsWith(".woff2")) {
      response.setHeader(
        "Cache-Control",
        "public, max-age=31536000, immutable",
      );
    } else if (
      request.url === "/" ||
      request.url.startsWith("/?") ||
      request.url.endsWith(".html")
    ) {
      response.setHeader("Cache-Control", "no-cache");
    } else {
      response.setHeader("Cache-Control", "public, max-age=86400");
    }

    next();
  });
}
