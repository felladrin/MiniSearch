import path from "node:path";
import { fileURLToPath } from "node:url";
import viteBasicSSLPlugin from "@vitejs/plugin-basic-ssl";
import viteReactPlugin from "@vitejs/plugin-react";
import dotenv from "dotenv";
import getGitCommitHash from "helper-git-hash";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import { cacheServerHook } from "./server/cacheServerHook";
import { compressionServerHook } from "./server/compressionServerHook";
import { crossOriginServerHook } from "./server/crossOriginServerHook";
import { internalApiEndpointServerHook } from "./server/internalApiEndpointServerHook";
import { rerankerServiceHook } from "./server/rerankerServiceHook";
import { searchEndpointServerHook } from "./server/searchEndpointServerHook";
import { getSearchToken, regenerateSearchToken } from "./server/searchToken";
import { statusEndpointServerHook } from "./server/statusEndpointServerHook";
import { validateAccessKeyServerHook } from "./server/validateAccessKeyServerHook";

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
      VITE_ACCESS_KEYS_ENABLED: JSON.stringify(
        Boolean(process.env.ACCESS_KEYS),
      ),
      VITE_ACCESS_KEY_TIMEOUT_HOURS: JSON.stringify(
        Number(process.env.ACCESS_KEY_TIMEOUT_HOURS) || 0,
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
      VITE_INTERNAL_API_ENABLED: JSON.stringify(
        Boolean(process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL),
      ),
      VITE_INTERNAL_API_NAME: JSON.stringify(
        process.env.INTERNAL_OPENAI_COMPATIBLE_API_NAME,
      ),
      VITE_DEFAULT_INFERENCE_TYPE: JSON.stringify(
        process.env.DEFAULT_INFERENCE_TYPE,
      ),
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
      {
        name: "configure-server-internal-api-endpoint",
        configureServer: internalApiEndpointServerHook,
        configurePreviewServer: internalApiEndpointServerHook,
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
