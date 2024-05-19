import {
  DownloadModelConfig,
  Wllama,
  WllamaConfig,
  SamplingConfig,
} from "@wllama/wllama";
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
  top_k: 0,
  top_p: 1,
  min_p: 0.05,
  tfs_z: 0.95,
  typical_p: 0.85,
  penalty_freq: 0.5,
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
    userPrefix: string;
    assistantPrefix: string;
    messageSuffix: string;
    sampling: SamplingConfig;
  };
} = {
  mobileDefault: {
    url: Array.from(
      { length: 7 },
      (_, i) =>
        `https://huggingface.co/Felladrin/gguf-sharded-Llama-160M-Chat-v1/resolve/main/Llama-160M-Chat-v1.Q8_0.shard-${(
          i + 1
        )
          .toString()
          .padStart(5, "0")}-of-00007.gguf`,
    ),
    userPrefix: "<|im_start|>user\n",
    assistantPrefix: "<|im_start|>assistant\n",
    messageSuffix: "<|im_end|>\n",
    sampling: commonSamplingConfig,
  },
  mobileLarger: {
    url: Array.from(
      { length: 10 },
      (_, i) =>
        `https://huggingface.co/Felladrin/gguf-sharded-TinyLlama-1.1B-1T-OpenOrca/resolve/main/tinyllama-1.1b-1t-openorca.Q3_K_S.shard-${(
          i + 1
        )
          .toString()
          .padStart(5, "0")}-of-00010.gguf`,
    ),
    userPrefix: "<|im_start|>user\n",
    assistantPrefix: "<|im_start|>assistant\n",
    messageSuffix: "<|im_end|>\n",
    sampling: commonSamplingConfig,
  },
  desktopDefault: {
    url: Array.from(
      { length: 7 },
      (_, i) =>
        `https://huggingface.co/Felladrin/gguf-sharded-stablelm-2-1_6b-chat/resolve/main/stablelm-2-1_6b-chat.Q8_0.shard-${(
          i + 1
        )
          .toString()
          .padStart(5, "0")}-of-00007.gguf`,
    ),
    userPrefix: "<|im_start|>user\n",
    assistantPrefix: "<|im_start|>assistant\n",
    messageSuffix: "<|im_end|>\n",
    sampling: commonSamplingConfig,
  },
  desktopLarger: {
    url: Array.from(
      { length: 51 },
      (_, i) =>
        `https://huggingface.co/Felladrin/gguf-sharded-Phi-3-mini-4k-instruct-iMat/resolve/main/phi-3-mini-4k-instruct-imat-Q5_K_M.shard-${(
          i + 1
        )
          .toString()
          .padStart(5, "0")}-of-00051.gguf`,
    ),
    userPrefix: "<|user|>\n",
    assistantPrefix: "<|assistant|>\n",
    messageSuffix: "<|end|>\n",
    sampling: commonSamplingConfig,
  },
};
