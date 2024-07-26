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
  temp: 0.35,
  dynatemp_range: 0.25,
  top_k: 35,
  top_p: 0.55,
  min_p: 0.05,
  typical_p: 0.85,
  penalty_repeat: 1.176,
  penalty_last_n: -1,
  mirostat: 2,
  mirostat_tau: 3.5,
};

export const availableModels: {
  [key in
    | "mobileDefault"
    | "mobileLarger"
    | "desktopDefault"
    | "desktopLarger"]: {
    url: string | string[];
    stopStrings: string[];
    cacheType: "f16" | "q8_0" | "q4_0";
    contextSize: number;
    sampling: SamplingConfig;
    shouldIncludeUrlsOnPrompt: boolean;
    buildPrompt: (query: string, searchResults: string) => string;
  };
} = {
  mobileDefault: {
    url: "https://huggingface.co/Felladrin/gguf-Lite-Mistral-150M-v2-Instruct/resolve/main/Lite-Mistral-150M-v2-Instruct.F16.Q5_K.gguf",
    buildPrompt: (query, searchResults) => `<s>user
${searchResults}

I found these results on the web. Can you help me with it?</s> 
<s>assistant
Sure! What do you need?</s>
<s>user
${query}</s>
<s>assistant
`,
    stopStrings: [],
    cacheType: "f16",
    contextSize: 2048,
    shouldIncludeUrlsOnPrompt: false,
    sampling: commonSamplingConfig,
  },
  mobileLarger: {
    url: "https://huggingface.co/Felladrin/gguf-LaMini-Flan-T5-77M/resolve/main/LaMini-Flan-T5-77M.Q5_K_M.gguf",
    buildPrompt: (query, searchResults) =>
      `Summarize:
${query}

${searchResults.slice(0, 1024)}...`,
    stopStrings: [],
    cacheType: "f16",
    contextSize: 2048,
    shouldIncludeUrlsOnPrompt: false,
    sampling: commonSamplingConfig,
  },
  desktopDefault: {
    url: "https://huggingface.co/Felladrin/gguf-h2o-danube3-500m-chat/resolve/main/h2o-danube3-500m-chat.F16.Q5_K.gguf",
    buildPrompt: (query, searchResults) =>
      `<|prompt|>
${searchResults}

I found these results on the web. Can you help me with it?</s>
<|answer|>
Sure! What do you need?</s>
<|prompt|>
${query}</s>
<|answer|>`,
    stopStrings: [],
    cacheType: "f16",
    contextSize: 2048,
    shouldIncludeUrlsOnPrompt: false,
    sampling: commonSamplingConfig,
  },
  desktopLarger: {
    url: "https://huggingface.co/Felladrin/gguf-LaMini-Flan-T5-248M/resolve/main/LaMini-Flan-T5-248M.Q5_K_M.gguf",
    buildPrompt: (query, searchResults) =>
      `Summarize:
${query}

${searchResults.slice(0, 1024)}...`,
    stopStrings: [],
    cacheType: "f16",
    contextSize: 2048,
    shouldIncludeUrlsOnPrompt: false,
    sampling: commonSamplingConfig,
  },
};
