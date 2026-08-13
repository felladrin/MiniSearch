export interface ServerConfig {
  accessKeysEnabled: boolean;
  accessKeyTimeoutHours: number;
  wllamaDefaultModelId: string;
  internalApiEnabled: boolean;
  internalApiName: string;
  defaultInferenceType: string;
  pageContentReadingEnabled: boolean;
}

/**
 * Reads a boolean environment variable, counting only an explicit `true` or
 * `1` as on, so an unset or misspelled value leaves the feature off.
 */
export function isEnvFlagEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

/**
 * Values used when the matching environment variable is unset. These mirror
 * `.env.example` and are the single source of truth for both the server
 * response and the client-side fallback.
 */
export const DEFAULT_WLLAMA_MODEL_ID = "littlelamb-290m";
export const DEFAULT_INFERENCE_TYPE = "browser";
export const DEFAULT_INTERNAL_API_NAME = "Internal API";
