import { defaultBackgroundImageUrl } from "./backgroundImage";
import { isF16Supported } from "./webGpu";

export enum Setting {
  enableAiResponse = "enableAiResponse",
  enableImageSearch = "enableImageSearch",
  enableWebGpu = "enableWebGpu",
  webLlmModelId = "webLlmModelId",
  wllamaModelId = "wllamaModelId",
  cpuThreads = "cpuThreads",
  searchResultsToConsider = "searchResultsToConsider",
  backgroundImageUrl = "backgroundImageUrl",
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
  [Setting.backgroundImageUrl]: defaultBackgroundImageUrl,
  [Setting.systemPrompt]: `You are a multilingual AI assistant. Provide detailed, step-by-step responses following these guidelines:
- Use Markdown
- Explain thoroughly
- Use an analytical, formal tone
- Break down complex problems
- Communicate thought process clearly
- Answer based on the given info and your general knowledge about the topic
- Include additional relevant context, even if not directly requested

Info:
{{searchResults}}`,
};

export type Settings = typeof defaultSettings;
