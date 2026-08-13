/**
 * Runtime-resolved server configuration.
 *
 * Fetches /api/config on first call so the published Docker image is
 * fully configurable via environment variables at runtime instead of
 * being locked to build-time defaults.
 */

import {
  DEFAULT_INFERENCE_TYPE,
  DEFAULT_INTERNAL_API_NAME,
  DEFAULT_WLLAMA_MODEL_ID,
  type ServerConfig,
} from "@shared/serverConfig";

export type { ServerConfig };

/**
 * Config to assume only where running without the server's values is harmless.
 * It is deliberately not used for `accessKeysEnabled`: treating an unreachable
 * server as "access keys are off" would skip the access key page entirely.
 */
export const FALLBACK_CONFIG: ServerConfig = {
  accessKeysEnabled: false,
  accessKeyTimeoutHours: 0,
  wllamaDefaultModelId: DEFAULT_WLLAMA_MODEL_ID,
  internalApiEnabled: false,
  internalApiName: DEFAULT_INTERNAL_API_NAME,
  defaultInferenceType: DEFAULT_INFERENCE_TYPE,
  pageContentReadingEnabled: false,
};

const FETCH_TIMEOUT_MS = 5000;

let cachedConfig: ServerConfig | null = null;
let pendingFetch: Promise<ServerConfig> | null = null;

async function fetchConfig(): Promise<ServerConfig> {
  const response = await fetch("/api/config", {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`/api/config responded with status ${response.status}`);
  }

  return (await response.json()) as ServerConfig;
}

/**
 * Returns the runtime server config, fetching /api/config on the first call and
 * caching a successful response.
 *
 * Rejects when the config cannot be retrieved, leaving each caller to decide
 * whether continuing without it is safe. A failed attempt is not cached, so a
 * transient blip does not lock the session out of its real configuration.
 */
export async function getConfig(): Promise<ServerConfig> {
  if (cachedConfig) return cachedConfig;

  if (!pendingFetch) {
    pendingFetch = fetchConfig().then(
      (config) => {
        cachedConfig = config;
        pendingFetch = null;
        return config;
      },
      (error) => {
        pendingFetch = null;
        throw error;
      },
    );
  }

  return pendingFetch;
}
