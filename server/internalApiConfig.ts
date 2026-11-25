import {
  DEFAULT_INTERNAL_API_CONTEXT_LENGTH,
  DEFAULT_INTERNAL_API_NAME,
} from "../shared/serverConfig.ts";
import { parseCommaSeparatedList } from "./parseCommaSeparatedList.ts";

/** The internal OpenAI-compatible API, as the environment configures it. */
export interface InternalApiConfig {
  /** Unset when the internal API is disabled. */
  baseUrl: string | undefined;
  apiKey: string | undefined;
  /** In order of preference. Empty means a random model from the API's `/models`. */
  models: string[];
  /** Shown in the UI as the name of the inference type. */
  name: string;
  /** Context window of the models, in tokens; the browser sizes its prompt budgets from it. */
  contextLength: number;
  /** Sent as `reasoning_effort`. Unset leaves the API's own default. */
  reasoningEffort: string | undefined;
  /** Upper bound on the `max_tokens` a client may ask for. */
  maxOutputTokens: number;
  /** How long the upstream may stay silent before an attempt is abandoned. */
  requestTimeoutMs: number;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

// The config is read on every request, and `/status` is polled by the
// container's health check, so a bad value would otherwise flood the log.
const reportedInvalidValues = new Set<string>();

function readPositiveInteger(variable: string, fallback: number): number {
  const value = process.env[variable]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  const report = `${variable}=${value}`;
  if (!reportedInvalidValues.has(report)) {
    reportedInvalidValues.add(report);
    console.error(
      `${variable} is not a positive integer ("${value}"); using ${fallback}.`,
    );
  }
  return fallback;
}

/**
 * Read on every call rather than once at startup, so the values always match
 * the environment of the process answering.
 */
export function getInternalApiConfig(): InternalApiConfig {
  const env = process.env;
  return {
    baseUrl: env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL || undefined,
    apiKey: env.INTERNAL_OPENAI_COMPATIBLE_API_KEY || undefined,
    models: parseCommaSeparatedList(env.INTERNAL_OPENAI_COMPATIBLE_API_MODEL),
    name: env.INTERNAL_OPENAI_COMPATIBLE_API_NAME || DEFAULT_INTERNAL_API_NAME,
    contextLength: readPositiveInteger(
      "INTERNAL_OPENAI_COMPATIBLE_API_CONTEXT_LENGTH",
      DEFAULT_INTERNAL_API_CONTEXT_LENGTH,
    ),
    reasoningEffort:
      env.INTERNAL_OPENAI_COMPATIBLE_API_REASONING_EFFORT?.trim() || undefined,
    maxOutputTokens: readPositiveInteger(
      "MODEL_DEFAULT_MAX_TOKENS",
      DEFAULT_MAX_OUTPUT_TOKENS,
    ),
    requestTimeoutMs: readPositiveInteger(
      "MODEL_REQUEST_TIMEOUT_MS",
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
  };
}
