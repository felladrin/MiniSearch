import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePluginNode } from "vite-plugin-node";

export default defineConfig(({ command }) => ({
  build: {
    target: 'esnext'
  },
  plugins: [
    react(),
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
