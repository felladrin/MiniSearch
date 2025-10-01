import { addLogEntry } from "./logEntries";
import { isF16Supported } from "./webGpu";

export const defaultSettings = {
  showEnableAiResponsePrompt: true,
  enableAiResponse: false,
  enableWebGpu: true,
  enableImageSearch: true,
  webLlmModelId: isF16Supported
    ? VITE_WEBLLM_DEFAULT_F16_MODEL_ID
    : VITE_WEBLLM_DEFAULT_F32_MODEL_ID,
  wllamaModelId: VITE_WLLAMA_DEFAULT_MODEL_ID,
  cpuThreads: Math.max(1, (navigator.hardwareConcurrency ?? 1) - 2),
  searchResultsToConsider: 3,
  searchResultsLimit: 15,
  systemPrompt: `Answer using the search results below as your primary source, supplemented by your own knowledge when needed.

Cite every fact from the search results by placing a link immediately after it in this format: [domain.com](https://full-url). The link text must be the top-level domain only (no "https://", "www.", or paths).

Only cite sources that appear in the search results below. Never fabricate or hallucinate citations.

Write in the same language as the query.

You may use these Markdown elements: anchor, bold, italic, code, quote, table.

Below are the search results fetched at {{dateTime}}.

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
  hordeApiKey: "0000000000",
  hordeModel: "",
  enterToSubmit: true,
  enableAiResponseScrolling: true,
  allowAiModelDownload: false,
  enableTextSearch: true,
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
