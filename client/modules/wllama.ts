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
    url: "https://huggingface.co/Felladrin/gguf-Lite-Mistral-150M-v2-Instruct/resolve/main/Lite-Mistral-150M-v2-Instruct.F16.Q6_K.gguf",
    buildPrompt: (query, searchResults) => `<s>user
Hello!</s> 
<s>assistant
Hi! How may I help you?</s>
<s>user
Take a look at these web search results:

${searchResults}

Now, using your own words, write a concise response to the following:

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
    url: "https://huggingface.co/Felladrin/gguf-Llama-160M-Chat-v1/resolve/main/Llama-160M-Chat-v1.Q6_K.gguf",
    buildPrompt: (query, searchResults) => `<|im_start|>system
You are an AI assistant. Your goal is to understand and respond to user inquiries with clarity.<|im_end|>
<|im_start|>user
Please search for the following:

${query}<|im_end|>
<|im_start|>assistant
Sure, here are the top search results:

${searchResults}<|im_end|>
<|im_start|>user
Perfect! Now answer with your own words:

${query}<|im_end|>
<|im_start|>assistant
`,
    stopStrings: ["<|im_end|>"],
    cacheType: "f16",
    contextSize: 2048,
    shouldIncludeUrlsOnPrompt: false,
    sampling: commonSamplingConfig,
  },
  desktopDefault: {
    url: "https://huggingface.co/Felladrin/gguf-sharded-h2o-danube3-500m-chat/resolve/main/h2o-danube3-500m-chat.shard-00001-of-00011.gguf",
    buildPrompt: (query, searchResults) =>
      `<|prompt|>${searchResults}

I found these results on the web, but I'm feeling a bit lost. Can you help me?</s>
<|answer|>Sure! What would you like to know? I'll do my best to fulfill your request.</s>
<|prompt|>${query}</s>
<|answer|>`,
    stopStrings: [],
    cacheType: "f16",
    contextSize: 2048,
    shouldIncludeUrlsOnPrompt: true,
    sampling: commonSamplingConfig,
  },
  desktopLarger: {
    url: "https://huggingface.co/Felladrin/gguf-sharded-Phi-3-mini-4k-instruct/resolve/main/Phi-3-mini-4k-instruct.Q6_K_L.shard-00001-of-00034.gguf",
    buildPrompt: (query, searchResults) => `<|system|>
You are a helpful assistant.<|end|>
<|user|>
${searchResults}

I found these results on the web, but I'm feeling a bit lost. Can you help me?<|end|>
<|assistant|>
Sure! What would you like to know? I'll do my best to answer that in your language.<|end|>
<|user|>
${query}<|end|>
<|assistant|>
`,
    stopStrings: [],
    cacheType: "f16",
    contextSize: 2048,
    shouldIncludeUrlsOnPrompt: true,
    sampling: commonSamplingConfig,
  },
};
