import { addLogEntry } from "./logEntries";
import { isF16Supported } from "./webGpu";

export const defaultSettings = {
  enableAiResponse: true,
  enableWebGpu: true,
  enableImageSearch: true,
  webLlmModelId: isF16Supported
    ? "Qwen2-0.5B-Instruct-q4f16_1-MLC"
    : "TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC",
  wllamaModelId: "qwen-2.5-0.5b",
  cpuThreads: 1,
  searchResultsToConsider: 3,
  systemPrompt: `You are a research assistant. Provide detailed, step-by-step responses following these guidelines:
- Use Markdown
- Explain thoroughly
- Use an analytical, formal tone
- Break down complex problems
- Communicate thought process clearly
- Keep in mind today's date and time ({{dateTime}}).
- Answer in the same language as the person interacting with you
- Base your responses on the provided search results and your general knowledge about the topic
- Include additional relevant context, even if not directly requested

Search results:
{{searchResults}}`,
  inferenceType: "browser",
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
  { value: "browser", label: "Browser-Based Inference" },
  { value: "openai", label: "OpenAI-Compatible API" },
];
