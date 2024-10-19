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
  systemPrompt: `Provide detailed, step-by-step responses following these guidelines:
- Base your responses on the provided search results and your general knowledge about the topic.
- Answer in the same language as I ask, with an analytical tone.
- Use Markdown format, without headers.
- Keep in mind today's date and time ({{dateTime}}).
- Include additional relevant info you think would be good to know.

Search results:
{{searchResults}}`,
  inferenceType: VITE_DEFAULT_INFERENCE_TYPE,
  openAiApiBaseUrl: "",
  openAiApiKey: "",
  openAiApiModel: "",
  enterToSubmit: true,
};

addLogEntry(
  `Number of logical processors in CPU: ${navigator.hardwareConcurrency ?? "unknown"}`,
);

export type Settings = typeof defaultSettings;

export const inferenceTypes = [
  { value: "browser", label: "Browser-Based" },
  { value: "openai", label: "OpenAI-Compatible API" },
  ...(VITE_INTERNAL_API_ENABLED
    ? [{ value: "internal", label: VITE_INTERNAL_API_NAME }]
    : []),
];
