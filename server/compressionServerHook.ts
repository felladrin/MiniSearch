import compression from "http-compression";
import type { PreviewServer, ViteDevServer } from "vite";

/** Enables gzip/brotli compression on all responses. */
export function compressionServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use(compression());
}
