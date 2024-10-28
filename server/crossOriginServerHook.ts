import type { PreviewServer, ViteDevServer } from "vite";

export function crossOriginServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use((_, response, next) => {
    /** Server headers for cross origin isolation, which enable clients to use `SharedArrayBuffer` on the Browser. */
    const crossOriginIsolationHeaders: { key: string; value: string }[] = [
      {
        key: "Cross-Origin-Embedder-Policy",
        value: "require-corp",
      },
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
      {
        key: "Cross-Origin-Resource-Policy",
        value: "cross-origin",
      },
    ];

    for (const { key, value } of crossOriginIsolationHeaders) {
      response.setHeader(key, value);
    }

    next();
  });
}
