import { PreviewServer, ViteDevServer } from "vite";
import compression from "http-compression";

export function compressionServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use(compression());
}
