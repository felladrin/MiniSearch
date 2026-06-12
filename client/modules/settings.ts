import { addLogEntry } from "./logEntries";

/**
 * Default application settings configuration
 */
export const defaultSettings = {
  showEnableAiResponsePrompt: true,
  enableAiResponse: false,
  enableImageSearch: true,
  wllamaModelId: VITE_WLLAMA_DEFAULT_MODEL_ID,
  cpuThreads: Math.max(1, (navigator.hardwareConcurrency ?? 1) - 2),
  searchResultsToConsider: 3,
  searchResultsLimit: 15,
  systemPrompt: `Answer using the search results below as your primary source, supplemented by your own knowledge when needed. Write your response in the same language as the query.

Cite every fact taken from the search results with an inline Markdown link immediately after it. Format: [domain.com](https://full-url). Use only the top-level domain (no https://, www., or paths) as link text. Example: [youtube.com](https://www.youtube.com/watch?v=dQw4w9WgXcQ).

When the search results disagree with each other, point out the conflict. When you rely on your own knowledge because the results don't cover something, make that clear rather than presenting it as sourced.

Today's date is {{currentDate}}. Use it to resolve relative date references in both the question and the results.

You are allowed to use these Markdown elements: anchor, bold, italic, code, quote, table.

Search results:

{{searchResults}}`,
  inferenceType: VITE_DEFAULT_INFERENCE_TYPE,
  inferenceTemperature: 0.7,
  inferenceTopP: 0.9,
  minP: 0.1,
  inferenceFrequencyPenalty: 0,
  inferencePresencePenalty: 0,
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
};

addLogEntry(
  `Number of logical processors in CPU: ${
    navigator.hardwareConcurrency ?? "unknown"
  }`,
);

export const inferenceTypes = [
  { value: "browser", label: "In the browser (Private)" },
  { value: "openai", label: "Remote server (API)" },
  { value: "horde", label: "AI Horde (Pre-configured)" },
  ...(VITE_INTERNAL_API_ENABLED
    ? [{ value: "internal", label: VITE_INTERNAL_API_NAME }]
    : []),
];
