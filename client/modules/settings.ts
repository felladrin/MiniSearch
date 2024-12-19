import { addLogEntry } from "./logEntries";
import { isF16Supported } from "./webGpu";

export const defaultSettings = {
  enableAiResponse: true,
  enableWebGpu: true,
  enableImageSearch: true,
  webLlmModelId: isF16Supported
    ? VITE_WEBLLM_DEFAULT_F16_MODEL_ID
    : VITE_WEBLLM_DEFAULT_F32_MODEL_ID,
  wllamaModelId: VITE_WLLAMA_DEFAULT_MODEL_ID,
  cpuThreads: Math.max(1, (navigator.hardwareConcurrency ?? 1) - 2),
  searchResultsToConsider: 3,
  searchResultsLimit: 15,
  systemPrompt: `I need assistance with my research, so please provide easy-to-understand responses following these guidelines:
- Base your responses on the provided search results and your general knowledge about the topic.
- Answer in the same language in which I ask, with an analytical tone.
- Keep in mind that the current date and time is {{dateTime}}.
- Use Markdown format, without headers.
- Use citations for any information that is not common knowledge. Place the citation immediately after the fact or quote it supports using this Markdown format: [[1](https://example.com)], where the number increments for each unique source. Only use URLs that are explicitly provided in the context.
- Include any additional relevant information you think would be good to know.

Search results:
{{searchResults}}`,
  inferenceType: VITE_DEFAULT_INFERENCE_TYPE,
  inferenceTemperature: 0.5,
  inferenceTopP: 0.9,
  inferenceFrequencyPenalty: 0.5,
  inferencePresencePenalty: 0.3,
  openAiApiBaseUrl: "",
  openAiApiKey: "",
  openAiApiModel: "",
  enterToSubmit: true,
  enableAiResponseScrolling: true,
  allowAiModelDownload: false,
  enableTextSearch: true,
  selectedVoiceId: "",
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
