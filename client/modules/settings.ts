import { addLogEntry } from "./logEntries";
import { isF16Supported } from "./webGpu";

export enum Setting {
  enableAiResponse = "enableAiResponse",
  enableImageSearch = "enableImageSearch",
  enableWebGpu = "enableWebGpu",
  webLlmModelId = "webLlmModelId",
  wllamaModelId = "wllamaModelId",
  cpuThreads = "cpuThreads",
  searchResultsToConsider = "searchResultsToConsider",
  systemPrompt = "systemPrompt",
}

export const defaultSettings = {
  [Setting.enableAiResponse]: true,
  [Setting.enableWebGpu]: true,
  [Setting.enableImageSearch]: true,
  [Setting.webLlmModelId]: isF16Supported
    ? "Qwen2-0.5B-Instruct-q4f16_1-MLC"
    : "TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC",
  [Setting.wllamaModelId]: "default",
  [Setting.cpuThreads]: 1,
  [Setting.searchResultsToConsider]: 3,
  [Setting.systemPrompt]: `You are a research assistant. Provide detailed, step-by-step responses following these guidelines:
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
};

addLogEntry(
  `Number of logical processors in CPU: ${navigator.hardwareConcurrency ?? "unknown"}`,
);

export type Settings = typeof defaultSettings;
