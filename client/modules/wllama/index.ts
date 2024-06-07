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
import { parseModelUrl } from "./parseModelUrl";

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
    userSuffix: string;
    assistantPrefix: string;
    assistantSuffix: string;
    cacheType?: "f16" | "q8_0" | "q4_0";
    sampling: SamplingConfig;
  };
} = {
  mobileDefault: {
    url: parseModelUrl(
      "https://huggingface.co/Felladrin/gguf-sharded-Llama-160M-Chat-v1/resolve/main/Llama-160M-Chat-v1.Q8_0.shard-00001-of-00007.gguf",
    ),
    userPrefix: "<|im_start|>user\n",
    userSuffix: "<|im_end|>\n",
    assistantPrefix: "<|im_start|>assistant\n",
    assistantSuffix: "<|im_end|>\n",
    cacheType: "f16",
    sampling: commonSamplingConfig,
  },
  mobileLarger: {
    url: parseModelUrl(
      "https://huggingface.co/Felladrin/gguf-sharded-Aira-2-355M/resolve/main/Aira-2-355M.Q3_K_M.shard-00001-of-00005.gguf",
    ),
    userPrefix: "<|startofinstruction|>",
    userSuffix: "<|endofinstruction|>",
    assistantPrefix: "",
    assistantSuffix: "<|endofcompletion|>",
    cacheType: "f16",
    sampling: commonSamplingConfig,
  },
  desktopDefault: {
    url: parseModelUrl(
      "https://huggingface.co/Felladrin/gguf-sharded-h2o-danube2-1.8b-chat/resolve/main/h2o-danube2-1.8b-chat.Q8_0.shard-00001-of-00026.gguf",
    ),
    userPrefix: "<|prompt|>\n",
    userSuffix: "</s>\n",
    assistantPrefix: "<|answer|>\n",
    assistantSuffix: "</s>\n",
    cacheType: "f16",
    sampling: commonSamplingConfig,
  },
  desktopLarger: {
    url: parseModelUrl(
      "https://huggingface.co/Felladrin/gguf-sharded-phi-2-orange-v2/resolve/main/phi-2-orange-v2.Q5_K_M.shard-00001-of-00025.gguf",
    ),
    userPrefix: "<|im_start|>user\n",
    userSuffix: "<|im_end|>\n",
    assistantPrefix: "<|im_start|>assistant\n",
    assistantSuffix: "<|im_end|>\n",
    cacheType: "f16",
    sampling: commonSamplingConfig,
  },
};
