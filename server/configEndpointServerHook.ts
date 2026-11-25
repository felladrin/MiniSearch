import type { PreviewServer, ViteDevServer } from "vite";
import {
  DEFAULT_INFERENCE_TYPE,
  DEFAULT_PARENT_WINDOW_ORIGINS,
  DEFAULT_WLLAMA_GPU_MODEL_ID,
  DEFAULT_WLLAMA_MODEL_ID,
  type ServerConfig,
} from "../shared/serverConfig.ts";
import { getInternalApiConfig } from "./internalApiConfig.ts";
import { parseCommaSeparatedList } from "./parseCommaSeparatedList.ts";
import { getSearchToken } from "./searchToken.ts";

/**
 * Serves the server config at /api/config at runtime rather than compiling it
 * in, so the published Docker image is configurable via environment variables.
 */
export function configEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use((req, res, next) => {
    if (req.url !== "/api/config" || req.method !== "GET") {
      return next();
    }

    const internalApi = getInternalApiConfig();
    const config: ServerConfig = {
      accessKeysEnabled:
        parseCommaSeparatedList(process.env.ACCESS_KEYS).length > 0,
      accessKeyTimeoutHours: Number(process.env.ACCESS_KEY_TIMEOUT_HOURS) || 0,
      wllamaDefaultModelId:
        process.env.WLLAMA_DEFAULT_MODEL_ID || DEFAULT_WLLAMA_MODEL_ID,
      // Not a fallback to WLLAMA_DEFAULT_MODEL_ID: `.env.example` sets that
      // one, so most deployments would hand GPUs the CPU default.
      wllamaDefaultGpuModelId:
        process.env.WLLAMA_DEFAULT_GPU_MODEL_ID || DEFAULT_WLLAMA_GPU_MODEL_ID,
      internalApiEnabled: Boolean(internalApi.baseUrl),
      internalApiName: internalApi.name,
      internalApiContextLength: internalApi.contextLength,
      defaultInferenceType:
        process.env.DEFAULT_INFERENCE_TYPE || DEFAULT_INFERENCE_TYPE,
      // Served here rather than compiled into the bundle so a client always
      // gets the token of the server answering it, and a reload is enough to
      // pick up a new one.
      searchToken: getSearchToken(),
      // Only an unset variable gets the default: an empty one is how a
      // deployment stops posting the query to any embedding page.
      parentWindowOrigins:
        process.env.PARENT_WINDOW_ORIGINS === undefined
          ? DEFAULT_PARENT_WINDOW_ORIGINS
          : parseCommaSeparatedList(process.env.PARENT_WINDOW_ORIGINS),
    };

    res.setHeader("Content-Type", "application/json");
    // The whole point of this endpoint is that a restart with different env
    // vars takes effect immediately, so the response must never be reused.
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(config));
  });
}
