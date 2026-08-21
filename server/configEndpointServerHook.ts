import type { PreviewServer, ViteDevServer } from "vite";
import {
  DEFAULT_INFERENCE_TYPE,
  DEFAULT_INTERNAL_API_NAME,
  DEFAULT_WLLAMA_MODEL_ID,
  type ServerConfig,
} from "../shared/serverConfig.ts";
import { getSearchToken } from "./searchToken.ts";

/**
 * Vite server hook that serves runtime server config at /api/config.
 * Replaces the compile-time VITE_* defines so the published Docker image
 * is fully configurable via environment variables at runtime.
 */
export function configEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use((req, res, next) => {
    if (req.url !== "/api/config" || req.method !== "GET") {
      return next();
    }

    const config: ServerConfig = {
      accessKeysEnabled: Boolean(process.env.ACCESS_KEYS),
      accessKeyTimeoutHours: Number(process.env.ACCESS_KEY_TIMEOUT_HOURS) || 0,
      wllamaDefaultModelId:
        process.env.WLLAMA_DEFAULT_MODEL_ID || DEFAULT_WLLAMA_MODEL_ID,
      internalApiEnabled: Boolean(
        process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL,
      ),
      internalApiName:
        process.env.INTERNAL_OPENAI_COMPATIBLE_API_NAME ||
        DEFAULT_INTERNAL_API_NAME,
      defaultInferenceType:
        process.env.DEFAULT_INFERENCE_TYPE || DEFAULT_INFERENCE_TYPE,
      // Served here rather than compiled into the bundle so a client always
      // gets the token of the server answering it, and a reload is enough to
      // pick up a new one.
      searchToken: getSearchToken(),
    };

    res.setHeader("Content-Type", "application/json");
    // The whole point of this endpoint is that a restart with different env
    // vars takes effect immediately, so the response must never be reused.
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(config));
  });
}
