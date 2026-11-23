import {
  CITATION_EXAMPLE,
  DEFAULT_SYSTEM_PROMPT,
} from "@shared/defaultSystemPrompt";
import {
  DEFAULT_INFERENCE_TYPE,
  DEFAULT_WLLAMA_GPU_MODEL_ID,
  DEFAULT_WLLAMA_MODEL_ID,
  type ServerConfig,
} from "@shared/serverConfig";
import { FALLBACK_CONFIG } from "./config";
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
 * Whether this profile picked an OS voice before the local engine existed.
 * Such a value is a bare `speechSynthesis` voice URI rather than a prefixed
 * one, and picking it was a deliberate choice, so the profile keeps the system
 * engine instead of being moved onto a model download on the next upgrade.
 */
const hasLegacySystemVoice = (() => {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}",
    );
    if (typeof stored !== "object" || stored === null) return false;
    const { selectedVoiceId, textToSpeechEngine } = stored as Record<
      string,
      unknown
    >;
    return (
      textToSpeechEngine === undefined &&
      typeof selectedVoiceId === "string" &&
      selectedVoiceId.length > 0 &&
      !selectedVoiceId.startsWith("piper:") &&
      !selectedVoiceId.startsWith("system:")
    );
  } catch {
    return false;
  }
})();

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
  enableDictation: true,
  enableLocalDictationModel: true,
  textToSpeechEngine: (hasLegacySystemVoice ? "system" : "local") as
    | "local"
    | "system",
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

const coreInferenceTypes = [
  { value: "browser", label: "In the browser" },
  { value: "openai", label: "Remote server (OpenAI-compatible API)" },
  { value: "horde", label: "AI Horde" },
] as const;

export function getInferenceTypes(config: ServerConfig) {
  return [
    ...coreInferenceTypes,
    ...(config.internalApiEnabled
      ? [{ value: "internal" as const, label: config.internalApiName }]
      : []),
  ];
}

/** The citation example the default prompt carried until 2026-11-08. */
const PREVIOUS_CITATION_EXAMPLE =
  "[youtube.com](https://www.youtube.com/watch?v=dQw4w9WgXcQ)";

/**
 * Moves a saved prompt that is exactly the previous default onto the current
 * one. Settings store the whole prompt, so without this a profile that saved
 * its settings would keep the old citation example forever. A prompt the user
 * edited is their choice and stays.
 */
export function upgradeUntouchedSystemPrompt(
  settings: typeof defaultSettings,
): typeof defaultSettings {
  const previousDefault = DEFAULT_SYSTEM_PROMPT.replace(
    CITATION_EXAMPLE,
    PREVIOUS_CITATION_EXAMPLE,
  );
  return settings.systemPrompt === previousDefault
    ? { ...settings, systemPrompt: DEFAULT_SYSTEM_PROMPT }
    : settings;
}

/**
 * The inference type to use in place of one this server does not offer: the
 * server's default, unless that is not offered either (`DEFAULT_INFERENCE_TYPE`
 * still names a backend whose config was removed), then the shipped default,
 * which is always offered.
 */
function offeredInferenceType(requested: string, config: ServerConfig): string {
  const offered: string[] = getInferenceTypes(config).map(({ value }) => value);
  if (offered.includes(requested)) return requested;
  return offered.includes(config.defaultInferenceType)
    ? config.defaultInferenceType
    : DEFAULT_INFERENCE_TYPE;
}

/**
 * These are defaults, not overrides: they seed a profile that has never been
 * saved and are ignored once the user has settings of their own, since a stored
 * value is a choice even when it matches what the code ships with.
 *
 * The one stored value that is checked is the inference type: when the server
 * no longer offers it (the operator removed the internal API, say), the AI
 * settings select has no matching option and generation keeps routing to the
 * missing backend, so it moves to one the server offers.
 *
 * The Wllama model default depends on `hasWebGpu`, because a model that
 * answers quickly on a GPU can take minutes per answer on the CPU.
 */
export function applyServerConfig(
  settings: typeof defaultSettings,
  config: ServerConfig,
  userSettingsWereStored: boolean,
  hasWebGpu: boolean,
): typeof defaultSettings {
  if (userSettingsWereStored) {
    // The fallback is not the server's answer: it changes nothing, so a choice
    // survives a failed config fetch and is checked on the next load.
    if (config === FALLBACK_CONFIG) return settings;
    const inferenceType = offeredInferenceType(settings.inferenceType, config);
    if (inferenceType === settings.inferenceType) return settings;
    addLogEntry(
      `Inference type "${settings.inferenceType}" is not offered by this server; switched to "${inferenceType}"`,
    );
    return { ...settings, inferenceType };
  }

  return {
    ...settings,
    wllamaModelId: hasWebGpu
      ? config.wllamaDefaultGpuModelId || DEFAULT_WLLAMA_GPU_MODEL_ID
      : config.wllamaDefaultModelId || DEFAULT_WLLAMA_MODEL_ID,
    inferenceType: offeredInferenceType(
      config.defaultInferenceType || DEFAULT_INFERENCE_TYPE,
      config,
    ),
  };
}
