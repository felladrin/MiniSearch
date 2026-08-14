export interface ServerConfig {
  accessKeysEnabled: boolean;
  accessKeyTimeoutHours: number;
  wllamaDefaultModelId: string;
  internalApiEnabled: boolean;
  internalApiName: string;
  defaultInferenceType: string;
}

/**
 * Values used when the matching environment variable is unset. These mirror
 * `.env.example` and are the single source of truth for both the server
 * response and the client-side fallback.
 */
export const DEFAULT_WLLAMA_MODEL_ID = "littlelamb-290m";
export const DEFAULT_INFERENCE_TYPE = "browser";
export const DEFAULT_INTERNAL_API_NAME = "Internal API";
