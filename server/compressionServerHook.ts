import compression from "http-compression";
import type { PreviewServer, ViteDevServer } from "vite";

export function compressionServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use(compression());
}
