export interface ModelConfig {
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  requestTimeoutMs: number;
  maxConcurrentRequests: number;
  defaultMaxTokens: number;
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
}

export const modelConfig: ModelConfig = {
  maxRetries: 5,
  baseBackoffMs: 100,
  maxBackoffMs: 5000,
  requestTimeoutMs: 30000,
  maxConcurrentRequests: 10,
  defaultMaxTokens: 2048,
  temperature: 0.7,
  topP: 0.9,
  frequencyPenalty: 0.0,
  presencePenalty: 0.0,
};

/**
 * Get model configuration with environment variable overrides
 */
export function getModelConfig(): ModelConfig {
  return {
    ...modelConfig,
    maxRetries: process.env.MODEL_MAX_RETRIES
      ? parseInt(process.env.MODEL_MAX_RETRIES, 10)
      : modelConfig.maxRetries,
    baseBackoffMs: process.env.MODEL_BASE_BACKOFF_MS
      ? parseInt(process.env.MODEL_BASE_BACKOFF_MS, 10)
      : modelConfig.baseBackoffMs,
    maxBackoffMs: process.env.MODEL_MAX_BACKOFF_MS
      ? parseInt(process.env.MODEL_MAX_BACKOFF_MS, 10)
      : modelConfig.maxBackoffMs,
    requestTimeoutMs: process.env.MODEL_REQUEST_TIMEOUT_MS
      ? parseInt(process.env.MODEL_REQUEST_TIMEOUT_MS, 10)
      : modelConfig.requestTimeoutMs,
    maxConcurrentRequests: process.env.MODEL_MAX_CONCURRENT_REQUESTS
      ? parseInt(process.env.MODEL_MAX_CONCURRENT_REQUESTS, 10)
      : modelConfig.maxConcurrentRequests,
    defaultMaxTokens: process.env.MODEL_DEFAULT_MAX_TOKENS
      ? parseInt(process.env.MODEL_DEFAULT_MAX_TOKENS, 10)
      : modelConfig.defaultMaxTokens,
    temperature: process.env.MODEL_TEMPERATURE
      ? parseFloat(process.env.MODEL_TEMPERATURE)
      : modelConfig.temperature,
    topP: process.env.MODEL_TOP_P
      ? parseFloat(process.env.MODEL_TOP_P)
      : modelConfig.topP,
    frequencyPenalty: process.env.MODEL_FREQUENCY_PENALTY
      ? parseFloat(process.env.MODEL_FREQUENCY_PENALTY)
      : modelConfig.frequencyPenalty,
    presencePenalty: process.env.MODEL_PRESENCE_PENALTY
      ? parseFloat(process.env.MODEL_PRESENCE_PENALTY)
      : modelConfig.presencePenalty,
  };
}
