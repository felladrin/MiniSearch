import {
  DEFAULT_INFERENCE_TYPE,
  DEFAULT_WLLAMA_MODEL_ID,
  type ServerConfig,
} from "@shared/serverConfig";
import { addLogEntry } from "./logEntries";

export const SETTINGS_STORAGE_KEY = "settings";

/**
 * Whether this browser already had settings from an earlier visit. Read at
 * module load, before anything writes the key back, so `applyServerConfig()`
 * can tell an untouched profile from a user who deliberately picked a value
 * that happens to equal a default.
 */
export const hasStoredUserSettings =
  localStorage.getItem(SETTINGS_STORAGE_KEY) !== null;

/**
 * Default application settings configuration.
 * Runtime server config is merged in via `applyServerConfig()` after
 * /api/config is fetched.
 */
export const defaultSettings = {
  showEnableAiResponsePrompt: true,
  enableAiResponse: false,
  enableImageSearch: true,
  wllamaModelId: DEFAULT_WLLAMA_MODEL_ID,
  cpuThreads: Math.max(1, (navigator.hardwareConcurrency ?? 1) - 2),
  searchResultsLimit: 15,
  systemPrompt: `Answer using the search results below as your primary source, supplemented by your own knowledge when needed. Write your response in the same language as the query.

Cite every fact taken from the search results with an inline Markdown link immediately after it. Format: [domain.com](https://full-url). Use only the top-level domain (no https://, www., or paths) as link text. Example: [youtube.com](https://www.youtube.com/watch?v=dQw4w9WgXcQ).

When the search results disagree with each other, point out the conflict. When you rely on your own knowledge because the results don't cover something, make that clear rather than presenting it as sourced.

Today's date is {{currentDate}}. Use it to resolve relative date references in both the question and the results.

You are allowed to use these Markdown elements: anchor, bold, italic, code, quote, table.

Search results:

{{searchResults}}`,
  inferenceType: DEFAULT_INFERENCE_TYPE,
  openAiApiBaseUrl: "",
  openAiApiKey: "",
  openAiApiModel: "",
  openAiContextLength: 4096,
  hordeApiKey: "0000000000",
  hordeModel: "",
  enterToSubmit: true,
  enableAiResponseScrolling: true,
  allowAiModelDownload: false,
  enableTextSearch: true,
  enableHistory: true,
  historyMaxEntries: 1000,
  historyAutoCleanup: true,
  historyRetentionDays: 30,
  historyGroupByDate: true,
  selectedVoiceId: "",
  reasoningStartMarker: "<think>",
  reasoningEndMarker: "</think>",
  enableNotificationOnAiComplete: false,
};

addLogEntry(
  `Number of logical processors in CPU: ${
    navigator.hardwareConcurrency ?? "unknown"
  }`,
);

/**
 * Core inference types that are always available.
 */
const coreInferenceTypes = [
  { value: "browser", label: "In the browser (Private)" },
  { value: "openai", label: "Remote server (API)" },
  { value: "horde", label: "AI Horde (Pre-configured)" },
] as const;

/**
 * Returns the full list of inference types based on runtime server config.
 */
export function getInferenceTypes(config: ServerConfig) {
  return [
    ...coreInferenceTypes,
    ...(config.internalApiEnabled
      ? [{ value: "internal" as const, label: config.internalApiName }]
      : []),
  ];
}

/**
 * Applies the server-provided defaults to a settings object.
 *
 * These are defaults, not overrides: they seed a profile that has never been
 * saved and are ignored once the user has settings of their own, since a stored
 * value is a choice even when it matches what the code ships with.
 */
export function applyServerConfig(
  settings: typeof defaultSettings,
  config: ServerConfig,
  userSettingsWereStored: boolean,
): typeof defaultSettings {
  if (userSettingsWereStored) return settings;

  return {
    ...settings,
    wllamaModelId: config.wllamaDefaultModelId || DEFAULT_WLLAMA_MODEL_ID,
    inferenceType: config.defaultInferenceType || DEFAULT_INFERENCE_TYPE,
  };
}
