import { stat } from "node:fs/promises";
import path from "node:path";
import type { PreviewServer, ViteDevServer } from "vite";

/** Cache-Control per asset class: immutable for hashed assets, no-cache for HTML. */
export function cacheServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  const outDir = path.resolve(server.config.root, server.config.build.outDir);
  const assetsDir = path.join(outDir, "assets");

  server.middlewares.use(async (request, response, next) => {
    let cacheControlValue = "public, max-age=86400, must-revalidate";
    if (request.url?.startsWith("/assets/")) {
      // A missing asset falls through to the SPA fallback or a 404, and caching
      // that body for a year would poison the URL once the real file is deployed.
      cacheControlValue = (await isFileIn(assetsDir, outDir, request.url))
        ? "public, max-age=31536000, immutable"
        : "no-cache";
    } else if (
      request.url === "/" ||
      request.url?.startsWith("/?") ||
      request.url?.endsWith(".html")
    ) {
      cacheControlValue = "no-cache";
    }

    response.setHeader("Cache-Control", cacheControlValue);

    next();
  });
}

async function isFileIn(dir: string, outDir: string, url: string) {
  try {
    const { pathname } = new URL(url, "http://localhost");
    const file = path.join(outDir, decodeURIComponent(pathname));
    return file.startsWith(dir + path.sep) && (await stat(file)).isFile();
  } catch {
    return false;
  }
}
