export interface ServerConfig {
  accessKeysEnabled: boolean;
  accessKeyTimeoutHours: number;
  /** Default Wllama model where the browser has no WebGPU, so it runs on the CPU. */
  wllamaDefaultModelId: string;
  /** Default Wllama model where the browser has WebGPU. */
  wllamaDefaultGpuModelId: string;
  internalApiEnabled: boolean;
  internalApiName: string;
  defaultInferenceType: string;
  /** The CSRF token to hash into the `?token=` of every request to this server. */
  searchToken: string;
  /**
   * Origins allowed to receive the query when MiniSearch is embedded in an
   * iframe. The post goes to each one and the browser drops it unless the
   * embedding page is on that origin.
   */
  parentWindowOrigins: string[];
}

/**
 * Values used when the matching environment variable is unset. These mirror
 * `.env.example` and are the single source of truth for both the server
 * response and the client-side fallback.
 */
export const DEFAULT_WLLAMA_MODEL_ID = "littlelamb-290m";
export const DEFAULT_WLLAMA_GPU_MODEL_ID = "gemma-3-4b";
export const DEFAULT_INFERENCE_TYPE = "browser";
export const DEFAULT_INTERNAL_API_NAME = "Internal API";
export const DEFAULT_PARENT_WINDOW_ORIGINS = ["https://huggingface.co"];
