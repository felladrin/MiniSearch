import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePluginNode } from "vite-plugin-node";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { crossOriginIsolationHeaders } from "./server/headers";

export default defineConfig(({ command }) => ({
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
    viteStaticCopy({
      targets: [
        {
          src: "./node_modules/@wllama/wllama/esm",
          dest: "wllama",
        },
      ],
    }),
    {
      name: "configure-server-cross-origin-isolation",
      configureServer: (server) => {
        server.middlewares.use((_, res, next) => {
          crossOriginIsolationHeaders.forEach(({ key, value }) => {
            res.setHeader(key, value);
          });
          next();
        });
      },
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
}));
