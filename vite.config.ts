import { PreviewServer, ViteDevServer, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePluginNode } from "vite-plugin-node";
import { crossOriginIsolationHeaders } from "./server/headers";

export default defineConfig(({ command }) => {
  const crossOriginServerHook = <T extends ViteDevServer | PreviewServer>(
    server: T,
  ) => {
    server.middlewares.use((_, response, next) => {
      crossOriginIsolationHeaders.forEach(({ key, value }) => {
        response.setHeader(key, value);
      });
      next();
    });
  };

  return {
    root: "./client",
    server: {
      port: process.env.PORT ? Number(process.env.PORT) : 7860,
      hmr: {
        port: process.env.HMR_PORT ? Number(process.env.HMR_PORT) : 7861,
      },
    },
    build: {
      target: "esnext",
    },
    plugins: [
      react(),
      {
        name: "configure-server-cross-origin-isolation",
        configureServer: crossOriginServerHook,
        configurePreviewServer: crossOriginServerHook,
      },
      ...(command === "serve"
        ? VitePluginNode({
            adapter: ({ app, req, res, next }) => {
              if (req.url.startsWith("/search")) {
                app(req, res);
              } else {
                next();
              }
            },
            appPath: "./server/index.ts",
            exportName: "app",
          })
        : []),
    ],
  };
});
