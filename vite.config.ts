import path from "node:path";
import { fileURLToPath } from "node:url";
import viteBasicSSLPlugin from "@vitejs/plugin-basic-ssl";
import viteReactPlugin from "@vitejs/plugin-react";
import dotenv from "dotenv";
import getGitCommitHash from "helper-git-hash";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import { biEncoderServiceHook } from "./server/biEncoderServiceHook.ts";
import { cacheServerHook } from "./server/cacheServerHook.ts";
import { compressionServerHook } from "./server/compressionServerHook.ts";
import { configEndpointServerHook } from "./server/configEndpointServerHook.ts";
import { crossOriginServerHook } from "./server/crossOriginServerHook.ts";
import { internalApiEndpointServerHook } from "./server/internalApiEndpointServerHook.ts";
import { pageContentEndpointServerHook } from "./server/pageContentEndpointServerHook.ts";
import { rerankerServiceHook } from "./server/rerankerServiceHook.ts";
import { searchEndpointServerHook } from "./server/searchEndpointServerHook.ts";
import { getSearchToken, regenerateSearchToken } from "./server/searchToken.ts";
import { statusEndpointServerHook } from "./server/statusEndpointServerHook.ts";
import { validateAccessKeyServerHook } from "./server/validateAccessKeyServerHook.ts";

dotenv.config({ path: [".env", ".env.example"], quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ command }) => {
  if (command === "build") regenerateSearchToken();

  return {
    root: "./client",
    define: {
      VITE_SEARCH_TOKEN: JSON.stringify(getSearchToken()),
      VITE_BUILD_DATE_TIME: Date.now(),
      VITE_COMMIT_SHORT_HASH: JSON.stringify(getGitCommitHash({ short: true })),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client"),
        "@/modules": path.resolve(__dirname, "client/modules"),
        "@/components": path.resolve(__dirname, "client/components"),
        "@/hooks": path.resolve(__dirname, "client/hooks"),
        "@shared": path.resolve(__dirname, "shared"),
        "@root": path.resolve(__dirname),
      },
    },
    server: {
      host: process.env.HOST,
      port: process.env.PORT ? Number(process.env.PORT) : undefined,
      hmr: {
        port: process.env.HMR_PORT ? Number(process.env.HMR_PORT) : undefined,
      },
      fs: {
        allow: [
          path.resolve(__dirname, "shared"),
          path.resolve(__dirname, "client"),
          path.resolve(__dirname),
        ],
      },
    },
    preview: {
      host: process.env.HOST,
      port: process.env.PORT ? Number(process.env.PORT) : undefined,
      allowedHosts:
        process.env.ALLOWED_HOSTS && process.env.ALLOWED_HOSTS.length > 0
          ? process.env.ALLOWED_HOSTS.split(",")
          : true,
    },
    build: {
      target: "esnext",
      chunkSizeWarningLimit: 5000,
    },
    plugins: [
      process.env.BASIC_SSL === "true" ? viteBasicSSLPlugin() : undefined,
      viteReactPlugin(),
      {
        name: "configure-server-compression",
        configureServer: compressionServerHook,
        configurePreviewServer: compressionServerHook,
      },
      {
        name: "configure-server-cross-origin-isolation",
        configureServer: crossOriginServerHook,
        configurePreviewServer: crossOriginServerHook,
      },
      {
        name: "configure-server-config-endpoint",
        configureServer: configEndpointServerHook,
        configurePreviewServer: configEndpointServerHook,
      },
      {
        name: "configure-server-search-endpoint",
        configureServer: searchEndpointServerHook,
        configurePreviewServer: searchEndpointServerHook,
      },
      {
        name: "configure-server-page-content-endpoint",
        configureServer: pageContentEndpointServerHook,
        configurePreviewServer: pageContentEndpointServerHook,
      },
      {
        name: "configure-server-status-endpoint",
        configureServer: statusEndpointServerHook,
        configurePreviewServer: statusEndpointServerHook,
      },
      {
        name: "configure-server-cache",
        configurePreviewServer: cacheServerHook,
      },
      {
        name: "configure-server-validate-access-key",
        configureServer: validateAccessKeyServerHook,
        configurePreviewServer: validateAccessKeyServerHook,
      },
      {
        name: "configure-server-internal-api-endpoint",
        configureServer: internalApiEndpointServerHook,
        configurePreviewServer: internalApiEndpointServerHook,
      },
      {
        name: "configure-server-bi-encoder-service",
        configureServer: biEncoderServiceHook,
        configurePreviewServer: biEncoderServiceHook,
      },
      {
        name: "configure-server-reranker-service",
        configureServer: rerankerServiceHook,
        configurePreviewServer: rerankerServiceHook,
      },
      visualizer({
        filename: "vite-build-stats.html",
      }),
    ],
  };
});
