import { DEFAULT_SYSTEM_PROMPT } from "@shared/defaultSystemPrompt";
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
 * `navigator.hardwareConcurrency` reports logical processors, so half of it
 * approximates the physical core count on the SMT CPUs most users have.
 * wllama's throughput peaks there and degrades past it: on a 16-core/32-thread
 * machine, 30 threads generated 3.5x slower than 16 and used 39% more memory.
 */
export function getDefaultCpuThreads(
  hardwareConcurrency: number = navigator.hardwareConcurrency ?? 1,
): number {
  return Math.max(1, Math.floor(hardwareConcurrency / 2));
}

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
  cpuThreads: getDefaultCpuThreads(),
  searchResultsLimit: 15,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
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
  enablePageContentFetch: true,
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
  { value: "browser", label: "In the browser" },
  { value: "openai", label: "Remote server (OpenAI-compatible API)" },
  { value: "horde", label: "AI Horde" },
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
