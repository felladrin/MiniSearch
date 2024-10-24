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
  cpuThreads: 1,
  searchResultsToConsider: 3,
  systemPrompt: `I need assistance with my research, so please provide short and clear responses following these guidelines:
- Base your responses on the provided search results and your general knowledge about the topic.
- Answer in the same language in which I ask, with an analytical tone.
- Use Markdown format, without headers.
- Keep in mind today's date and time ({{dateTime}}).
- Include any additional relevant information you think would be good to know.

Search results:
{{searchResults}}`,
  inferenceType: VITE_DEFAULT_INFERENCE_TYPE,
  openAiApiBaseUrl: "",
  openAiApiKey: "",
  openAiApiModel: "",
  enterToSubmit: true,
  allowAiModelDownload: false,
};

addLogEntry(
  `Number of logical processors in CPU: ${navigator.hardwareConcurrency ?? "unknown"}`,
);

export type Settings = typeof defaultSettings;

export const inferenceTypes = [
  { value: "browser", label: "In the browser (Private)" },
  { value: "openai", label: "Remote server (API)" },
  ...(VITE_INTERNAL_API_ENABLED
    ? [{ value: "internal", label: VITE_INTERNAL_API_NAME }]
    : []),
];
