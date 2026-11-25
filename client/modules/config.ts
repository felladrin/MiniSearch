/**
 * Runtime-resolved server configuration.
 *
 * Fetches /api/config on first call so the published Docker image is
 * fully configurable via environment variables at runtime instead of
 * being locked to build-time defaults.
 */

import {
  DEFAULT_INFERENCE_TYPE,
  DEFAULT_INTERNAL_API_CONTEXT_LENGTH,
  DEFAULT_INTERNAL_API_NAME,
  DEFAULT_WLLAMA_GPU_MODEL_ID,
  DEFAULT_WLLAMA_MODEL_ID,
  type ServerConfig,
} from "@shared/serverConfig";

export type { ServerConfig };

/**
 * Config to assume only where running without the server's values is harmless.
 * It is deliberately not used for `accessKeysEnabled`: treating an unreachable
 * server as "access keys are off" would skip the access key page entirely.
 *
 * `searchToken` has no harmless stand-in, so it is empty here. Anything that
 * needs it goes through `getConfig`, which rejects rather than handing back a
 * token the server would turn away. `parentWindowOrigins` is empty for the
 * same reason: without the server's list, no embedding page is trusted with
 * the query.
 */
export const FALLBACK_CONFIG: ServerConfig = {
  accessKeysEnabled: false,
  accessKeyTimeoutHours: 0,
  wllamaDefaultModelId: DEFAULT_WLLAMA_MODEL_ID,
  wllamaDefaultGpuModelId: DEFAULT_WLLAMA_GPU_MODEL_ID,
  internalApiEnabled: false,
  internalApiName: DEFAULT_INTERNAL_API_NAME,
  internalApiContextLength: DEFAULT_INTERNAL_API_CONTEXT_LENGTH,
  defaultInferenceType: DEFAULT_INFERENCE_TYPE,
  searchToken: "",
  parentWindowOrigins: [],
};

const FETCH_TIMEOUT_MS = 5000;

let cachedConfig: ServerConfig | null = null;
let pendingFetch: Promise<ServerConfig> | null = null;
let configGeneration = 0;

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
 * Rejects when the config cannot be retrieved, leaving each caller to decide
 * whether continuing without it is safe. A failed attempt is not cached, so a
 * transient blip does not lock the session out of its real configuration.
 */
export async function getConfig(): Promise<ServerConfig> {
  if (cachedConfig) return cachedConfig;

  if (!pendingFetch) {
    const generation = configGeneration;
    pendingFetch = fetchConfig().then(
      (config) => {
        if (generation === configGeneration) {
          cachedConfig = config;
          pendingFetch = null;
        }
        return config;
      },
      (error) => {
        if (generation === configGeneration) pendingFetch = null;
        throw error;
      },
    );
  }

  return pendingFetch;
}

/**
 * Each server process mints its own search token, so a restart leaves an open
 * page holding a token the server never issued. The 401 handler in
 * `search.ts` calls this before asking for the token again, which is the only
 * way a page that is already loaded can find out the token rotated.
 *
 * A fetch that is already in flight was started against the values this call
 * discards, so it is left to resolve its own callers without repopulating the
 * cache behind them.
 */
export function invalidateConfig(): void {
  cachedConfig = null;
  pendingFetch = null;
  configGeneration += 1;
}
