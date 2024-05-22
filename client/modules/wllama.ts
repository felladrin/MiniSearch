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

function parseModelUrl(url: string) {
  const urlPartsRegex = /(.*)-(\d{5})-of-(\d{5})\.gguf$/;

  const matches = url.match(urlPartsRegex);

  if (!matches || matches.length !== 4) return url;

  const baseURL = matches[1];

  const paddedShardsAmount = matches[3];

  const paddedShardNumbers = Array.from(
    { length: Number(paddedShardsAmount) },
    (_, i) => (i + 1).toString().padStart(5, "0"),
  );

  return paddedShardNumbers.map(
    (paddedShardNumber) =>
      `${baseURL}-${paddedShardNumber}-of-${paddedShardsAmount}.gguf`,
  );
}

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
    cacheType?: "f16" | "q8_0" | "q4_0";
    sampling: SamplingConfig;
  };
} = {
  mobileDefault: {
    url: parseModelUrl(
      "https://huggingface.co/Felladrin/gguf-sharded-Llama-160M-Chat-v1/resolve/main/Llama-160M-Chat-v1.Q8_0.shard-00001-of-00007.gguf",
    ),
    userPrefix: "<|im_start|>user\n",
    assistantPrefix: "<|im_start|>assistant\n",
    messageSuffix: "<|im_end|>\n",
    cacheType: "q8_0",
    sampling: commonSamplingConfig,
  },
  mobileLarger: {
    url: parseModelUrl(
      "https://huggingface.co/Felladrin/gguf-sharded-zephyr-220m-dpo-full/resolve/main/zephyr-220m-dpo-full.Q8_0.shard-00001-of-00007.gguf",
    ),
    userPrefix: "<|user|>\n",
    assistantPrefix: "<|assistant|>\n",
    messageSuffix: "</s>\n",
    cacheType: "q8_0",
    sampling: commonSamplingConfig,
  },
  desktopDefault: {
    url: parseModelUrl(
      "https://huggingface.co/Felladrin/gguf-sharded-h2o-danube2-1.8b-chat/resolve/main/h2o-danube2-1.8b-chat.Q8_0.shard-00001-of-00026.gguf",
    ),
    userPrefix: "<|prompt|>\n",
    assistantPrefix: "<|answer|>\n",
    messageSuffix: "</s>\n",
    cacheType: "f16",
    sampling: commonSamplingConfig,
  },
  desktopLarger: {
    url: parseModelUrl(
      "https://huggingface.co/Felladrin/gguf-sharded-Phi-3-mini-4k-instruct-iMat/resolve/main/phi-3-mini-4k-instruct-imat-Q5_K_M.shard-00001-of-00051.gguf",
    ),
    userPrefix: "<|user|>\n",
    assistantPrefix: "<|assistant|>\n",
    messageSuffix: "<|end|>\n",
    cacheType: "q4_0",
    sampling: commonSamplingConfig,
  },
};
