import { defineConfig } from "vite";
import viteReactPlugin from "@vitejs/plugin-react";
import viteBasicSSLPlugin from "@vitejs/plugin-basic-ssl";
import { statusEndpointServerHook } from "./server/statusEndpointServerHook";
import { searchEndpointServerHook } from "./server/searchEndpointServerHook";
import { compressionServerHook } from "./server/compressionServerHook";
import { crossOriginServerHook } from "./server/crossOriginServerHook";
import { cacheServerHook } from "./server/cacheServerHook";
import { getSearchToken, regenerateSearchToken } from "./server/searchToken";
import { visualizer } from "rollup-plugin-visualizer";
import getGitCommitHash from "helper-git-hash";
import { validateAccessKeyServerHook } from "./server/validateAccessKeyServerHook";
import dotenv from "dotenv";

dotenv.config({ path: [".env", ".env.example"] });

export default defineConfig(({ command }) => {
  if (command === "build") regenerateSearchToken();

  return {
    root: "./client",
    define: {
      VITE_SEARCH_TOKEN: JSON.stringify(getSearchToken()),
      VITE_BUILD_DATE_TIME: Date.now(),
      VITE_COMMIT_SHORT_HASH: JSON.stringify(getGitCommitHash({ short: true })),
      VITE_ACCESS_KEYS_ENABLED: JSON.stringify(
        Boolean(process.env.ACCESS_KEYS),
      ),
      VITE_WEBLLM_DEFAULT_F16_MODEL_ID: JSON.stringify(
        process.env.WEBLLM_DEFAULT_F16_MODEL_ID,
      ),
      VITE_WEBLLM_DEFAULT_F32_MODEL_ID: JSON.stringify(
        process.env.WEBLLM_DEFAULT_F32_MODEL_ID,
      ),
      VITE_WLLAMA_DEFAULT_MODEL_ID: JSON.stringify(
        process.env.WLLAMA_DEFAULT_MODEL_ID,
      ),
    },
    server: {
      host: process.env.HOST,
      port: process.env.PORT ? Number(process.env.PORT) : undefined,
      hmr: {
        port: process.env.HMR_PORT ? Number(process.env.HMR_PORT) : undefined,
      },
    },
    preview: {
      host: process.env.HOST,
      port: process.env.PORT ? Number(process.env.PORT) : undefined,
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
        name: "configure-server-search-endpoint",
        configureServer: searchEndpointServerHook,
        configurePreviewServer: searchEndpointServerHook,
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
      visualizer({
        filename: "vite-build-stats.html",
      }),
    ],
  };
});
