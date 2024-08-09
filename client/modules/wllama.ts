import {
  DownloadModelConfig,
  Wllama,
  WllamaConfig,
  SamplingConfig,
} from "@wllama/wllama/esm";
import singleThreadWllamaJsUrl from "@wllama/wllama/esm/single-thread/wllama.js?url";
import singleThreadWllamaWasmUrl from "@wllama/wllama/esm/single-thread/wllama.wasm?url";
import multiThreadWllamaJsUrl from "@wllama/wllama/esm/multi-thread/wllama.js?url";
import multiThreadWllamaWasmUrl from "@wllama/wllama/esm/multi-thread/wllama.wasm?url";
import multiThreadWllamaWorkerMjsUrl from "@wllama/wllama/esm/multi-thread/wllama.worker.mjs?url";
import { getNumberOfThreadsSetting } from "./pubSub";

export async function initializeWllama(
  modelUrl: string | string[],
  config?: {
    wllama?: WllamaConfig;
    model?: DownloadModelConfig;
  },
) {
  const wllama = new Wllama(
    {
      "single-thread/wllama.js": singleThreadWllamaJsUrl,
      "single-thread/wllama.wasm": singleThreadWllamaWasmUrl,
      "multi-thread/wllama.js": multiThreadWllamaJsUrl,
      "multi-thread/wllama.wasm": multiThreadWllamaWasmUrl,
      "multi-thread/wllama.worker.mjs": multiThreadWllamaWorkerMjsUrl,
    },
    config?.wllama,
  );

  await wllama.loadModelFromUrl(modelUrl, config?.model);

  return wllama;
}

const commonSamplingConfig: SamplingConfig = {
  temp: 0.2,
  dynatemp_range: 0.15,
  top_k: 0,
  top_p: 1,
  min_p: 0.1,
  typical_p: 0.85,
  penalty_repeat: 1.176,
  penalty_last_n: -1,
  mirostat: 2,
  mirostat_tau: 3.5,
};

export const availableModels: {
  [key in "mobile" | "mobileFallback" | "desktop"]: {
    url: string | string[];
    stopStrings: string[];
    cacheType: "f16" | "q8_0" | "q4_0";
    contextSize: number;
    sampling: SamplingConfig;
    shouldIncludeUrlsOnPrompt: boolean;
    buildPrompt: (query: string, searchResults: string) => string;
  };
} = {
  mobile: {
    url: "https://huggingface.co/Felladrin/gguf-h2o-danube3-500m-chat/resolve/main/h2o-danube3-500m-chat.F16.Q5_K.gguf",
    buildPrompt: (query, searchResults) => `${searchResults}</s>
<|prompt|>
${query}</s>
<|answer|>
`,
    stopStrings: [],
    cacheType: "f16",
    contextSize: 2048,
    shouldIncludeUrlsOnPrompt: false,
    sampling: commonSamplingConfig,
  },
  mobileFallback: {
    url: "https://huggingface.co/Felladrin/gguf-Llama-160M-Chat-v1/resolve/main/Llama-160M-Chat-v1.Q5_K_M.gguf",
    buildPrompt: (query, searchResults) => `${searchResults}<|im_end|>
<|im_start|>user
${query}<|im_end|>
<|im_start|>assistant
`,
    stopStrings: ["<|im_end|>"],
    cacheType: "f16",
    contextSize: 2048,
    shouldIncludeUrlsOnPrompt: false,
    sampling: commonSamplingConfig,
  },
  desktop:
    getNumberOfThreadsSetting() < 4
      ? {
          url: "https://huggingface.co/Felladrin/gguf-h2o-danube3-500m-chat/resolve/main/h2o-danube3-500m-chat.F16.Q5_K.gguf",
          buildPrompt: (query, searchResults) => `${searchResults}</s>
<|prompt|>
${query}</s>
<|answer|>
`,
          stopStrings: [],
          cacheType: "f16",
          contextSize: 2048,
          shouldIncludeUrlsOnPrompt: false,
          sampling: commonSamplingConfig,
        }
      : {
          url: "https://huggingface.co/Felladrin/gguf-sharded-Qwen2-1.5B-Instruct-imat/resolve/main/qwen2-1-00001-of-00022.gguf",
          buildPrompt: (query, searchResults) => `${searchResults}<|im_end|>
<|im_start|>user
${query}<|im_end|>
<|im_start|>assistant
`,
          stopStrings: [],
          cacheType: "f16",
          contextSize: 2048,
          shouldIncludeUrlsOnPrompt: false,
          sampling: commonSamplingConfig,
        },
};
