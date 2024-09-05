import { defaultBackgroundImageUrl } from "./backgroundImage";
import { isF16Supported } from "./webGpu";

export enum Setting {
  enableAiResponse = "enableAiResponse",
  enableWebGpu = "enableWebGpu",
  webLlmModelId = "webLlmModelId",
  wllamaModelId = "wllamaModelId",
  cpuThreads = "cpuThreads",
  searchResultsToConsider = "searchResultsToConsider",
  backgroundImageUrl = "backgroundImageUrl",
}

export const defaultSettings = {
  [Setting.enableAiResponse]: true,
  [Setting.enableWebGpu]: true,
  [Setting.webLlmModelId]: isF16Supported
    ? "Qwen2-0.5B-Instruct-q4f16_1-MLC"
    : "TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC",
  [Setting.wllamaModelId]: "smollm-360M-instruct",
  [Setting.cpuThreads]: 1,
  [Setting.searchResultsToConsider]: 3,
  [Setting.backgroundImageUrl]: defaultBackgroundImageUrl,
};

export type Settings = typeof defaultSettings;
