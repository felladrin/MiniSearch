import compression from "http-compression";
import type { PreviewServer, ViteDevServer } from "vite";

/**
 * Vite server hook for enabling HTTP compression
 * @param server - Vite dev server or preview server instance
 */
export function compressionServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use(compression());
}
