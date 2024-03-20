import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePluginNode } from "vite-plugin-node";
import { viteStaticCopy } from "vite-plugin-static-copy";
import crossOriginIsolation from "vite-plugin-cross-origin-isolation";

export default defineConfig(({ command }) => ({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 7860,
    hmr: {
      port: process.env.HMR_PORT ? Number(process.env.HMR_PORT) : 7861,
    },
  },
  build: {
    target: "esnext",
    rollupOptions: {
      external: ["/wllama/esm/index.js"],
    },
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
    crossOriginIsolation(),
    ...(command === "serve"
      ? VitePluginNode({
          adapter: ({ app, req, res, next }) => {
            if (req.url.startsWith("/search")) {
              app(req, res);
            } else {
              next();
            }
          },
          appPath: "./server.ts",
          exportName: "app",
        })
      : []),
  ],
}));
