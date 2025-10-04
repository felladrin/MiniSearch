import {
  type LoadModelConfig,
  type SamplingConfig,
  Wllama,
  type WllamaChatMessage,
  type WllamaConfig,
} from "@wllama/wllama";
import type { DownloadOptions } from "@wllama/wllama/esm/cache-manager";
import multiThreadWllamaWasmUrl from "@wllama/wllama/esm/multi-thread/wllama.wasm?url";
import singleThreadWllamaWasmUrl from "@wllama/wllama/esm/single-thread/wllama.wasm?url";
import { addLogEntry } from "./logEntries";
import { getSettings } from "./pubSub";
import { getSystemPrompt } from "./systemPrompt";
import { defaultContextSize } from "./textGenerationUtilities";

interface WllamaInitConfig {
  wllama?: WllamaConfig;
  model?: LoadModelConfig & DownloadOptions;
}

async function createWllamaInstance(config?: WllamaConfig): Promise<Wllama> {
  try {
    return new Wllama(
      {
        "single-thread/wllama.wasm": singleThreadWllamaWasmUrl,
        "multi-thread/wllama.wasm": multiThreadWllamaWasmUrl,
      },
      config,
    );
  } catch (error) {
    addLogEntry(
      `Failed to create Wllama instance: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  }
}

export async function initializeWllama(
  hfRepoId: string,
  hfFilePath: string,
  config?: WllamaInitConfig,
): Promise<Wllama> {
  addLogEntry("Initializing Wllama");

  try {
    const wllama = await createWllamaInstance(config?.wllama);

    await wllama.loadModelFromHF(hfRepoId, hfFilePath, {
      ...config?.model,
      n_threads: 1,
    });

    const randomDigitOrLetter = Math.random().toString(36).charAt(2);

    const warmupResponse = await wllama.createChatCompletion(
      [
        {
          role: "user",
          content: randomDigitOrLetter,
        },
      ],
      {
        nPredict: 1,
      },
    );

    const hasWarmupSucceeded = warmupResponse.length > 0;

    addLogEntry(
      `Wllama warmup ${hasWarmupSucceeded ? "succeeded" : "failed"}.`,
    );

    await wllama.exit();

    await wllama.loadModelFromHF(hfRepoId, hfFilePath, config?.model);

    addLogEntry("Wllama initialized successfully");

    return wllama;
  } catch (error) {
    addLogEntry(
      `Failed to initialize Wllama: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  }
}

export async function clearWllamaCache(): Promise<Wllama> {
  addLogEntry("Clearing Wllama cache");

  try {
    const wllama = await createWllamaInstance();
    await wllama.cacheManager.clear();
    addLogEntry("Wllama cache cleared successfully");
    return wllama;
  } catch (error) {
    addLogEntry(
      `Failed to clear Wllama cache: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  }
}

export interface WllamaModel {
  readonly label: string;
  readonly hfRepoId: string;
  readonly hfFilePath: string;
  readonly cacheTypeK: LoadModelConfig["cache_type_k"];
  readonly cacheTypeV: LoadModelConfig["cache_type_v"];
  readonly contextSize: number;
  readonly fileSizeInMegabytes: number;
  readonly shouldIncludeUrlsOnPrompt: boolean;
  readonly stopStrings?: string[];
  readonly stopTokens?: number[];
  readonly flash_attn?: boolean;
  getSampling: () => SamplingConfig;
  getMessages: (query: string, searchResults: string) => WllamaChatMessage[];
}

const createDefaultModelConfig = (): Omit<
  WllamaModel,
  "label" | "fileSizeInMegabytes" | "hfRepoId" | "hfFilePath"
> => ({
  getMessages: (query, searchResults) => [
    { role: "user", content: getSystemPrompt(searchResults) },
    { role: "assistant", content: "Ok!" },
    { role: "user", content: query },
  ],
  cacheTypeK: "f16",
  cacheTypeV: "f16",
  flash_attn: true,
  contextSize: defaultContextSize,
  shouldIncludeUrlsOnPrompt: true,
  getSampling: () => {
    const settings = getSettings();
    return {
      top_p: settings.inferenceTopP,
      min_p: settings.minP,
      temp: settings.inferenceTemperature,
      dynatemp_range: Math.max(0, settings.inferenceTemperature - 0.2),
      penalty_freq: settings.inferenceFrequencyPenalty,
      penalty_present: settings.inferencePresencePenalty,
      top_k: 30,
      penalty_repeat: 1,
      penalty_last_n: defaultContextSize,
      dry_base: 1.75,
      dry_multiplier: 0.25,
      dry_allowed_length: 3,
      dry_penalty_last_n: defaultContextSize,
    } as SamplingConfig;
  },
});

export const wllamaModels: Readonly<Record<string, WllamaModel>> = {
  "smollm2-135m": {
    ...createDefaultModelConfig(),
    label: "SmolLM 2 135M",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-SmolLM2-135M-Instruct",
    hfFilePath: "model.shard-00001-of-00004.gguf",
    fileSizeInMegabytes: 102,
  },
  "lfm2-350m": {
    ...createDefaultModelConfig(),
    label: "LFM2 350M",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-LFM2-350M",
    hfFilePath: "model.shard-00001-of-00004.gguf",
    fileSizeInMegabytes: 221,
  },
  "gemma-3-270m": {
    ...createDefaultModelConfig(),
    label: "Gemma 3 270M",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-gemma-3-270m-it",
    hfFilePath: "model.shard-00001-of-00002.gguf",
    fileSizeInMegabytes: 250,
  },
  "smollm2-360m": {
    ...createDefaultModelConfig(),
    label: "SmolLM 2 360M",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-SmolLM2-360M-Instruct",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 260,
  },
  "minicpm4-0.5b": {
    ...createDefaultModelConfig(),
    label: "MiniCPM4 0.5B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-MiniCPM4-0.5B-QAT",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 267,
  },
  "falcon-h1-0.5b": {
    ...createDefaultModelConfig(),
    label: "Falcon H1 0.5B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Falcon-H1-0.5B-Instruct",
    hfFilePath: "model.shard-00001-of-00011.gguf",
    fileSizeInMegabytes: 306,
  },
  "qwen-3-0.6b": {
    ...createDefaultModelConfig(),
    label: "Qwen 3 0.6B",
    hfRepoId: "Felladrin/gguf-sharded-UD-Q4_K_XL-Qwen3-0.6B",
    hfFilePath: "model.shard-00001-of-00004.gguf",
    fileSizeInMegabytes: 406,
  },
  "lfm2-700m": {
    ...createDefaultModelConfig(),
    label: "LFM2 700M",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-LFM2-700M",
    hfFilePath: "model.shard-00001-of-00006.gguf",
    fileSizeInMegabytes: 449,
  },
  "lfm2-1.2b": {
    ...createDefaultModelConfig(),
    label: "LFM2 1.2B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-LFM2-1.2B",
    hfFilePath: "model.shard-00001-of-00007.gguf",
    fileSizeInMegabytes: 700,
  },
  "granite-3.1-1b": {
    ...createDefaultModelConfig(),
    label: "Granite 3.1 1B [400M]",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-granite-3.1-1b-a400m-instruct",
    hfFilePath: "model.shard-00001-of-00020.gguf",
    fileSizeInMegabytes: 775,
  },
  "llama-3.2-1b": {
    ...createDefaultModelConfig(),
    label: "Llama 3.2 1B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Llama-3.2-1B-Instruct",
    hfFilePath: "model.shard-00001-of-00004.gguf",
    fileSizeInMegabytes: 776,
  },
  "gemma-3-1b": {
    ...createDefaultModelConfig(),
    label: "Gemma 3 1B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-gemma-3-1b-it",
    hfFilePath: "model.shard-00001-of-00003.gguf",
    fileSizeInMegabytes: 781,
  },
  "pints-1.5b": {
    ...createDefaultModelConfig(),
    label: "Pints 1.5B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-1.5-Pints-16K-v0.1",
    hfFilePath: "model.shard-00001-of-00018.gguf",
    fileSizeInMegabytes: 905,
  },
  "olmo-2-0425-1b": {
    ...createDefaultModelConfig(),
    label: "OLMo 2 1B",
    hfRepoId: "Felladrin/gguf-sharded-UD-Q4_K_XL-OLMo-2-0425-1B-Instruct",
    hfFilePath: "model.shard-00001-of-00006.gguf",
    fileSizeInMegabytes: 967,
  },
  "stablelm-2-zephyr-1.6b": {
    ...createDefaultModelConfig(),
    label: "StableLM 2 Zephyr 1.6B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-stablelm-2-zephyr-1.6b",
    hfFilePath: "model.shard-00001-of-00006.gguf",
    fileSizeInMegabytes: 989,
  },
  "smollm2-1.7b": {
    ...createDefaultModelConfig(),
    label: "SmolLM 2 1.7B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-SmolLM2-1.7B-Instruct",
    hfFilePath: "model.shard-00001-of-00012.gguf",
    fileSizeInMegabytes: 999,
  },
  "falcon-3-1b": {
    ...createDefaultModelConfig(),
    label: "Falcon 3 1B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Falcon3-1B-Instruct",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 1020,
  },
  "aceinstruct-1.5b": {
    ...createDefaultModelConfig(),
    label: "AceInstruct 1.5B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-AceInstruct-1.5B",
    hfFilePath: "model.shard-00001-of-00006.gguf",
    fileSizeInMegabytes: 1070,
  },
  "deepseek-r1-distill-qwen-1.5b": {
    ...createDefaultModelConfig(),
    label: "DeepSeek R1 Distill Qwen 1.5B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-DeepSeek-R1-Distill-Qwen-1.5B",
    hfFilePath: "model.shard-00001-of-00006.gguf",
    fileSizeInMegabytes: 1070,
  },
  "internlm-2.5-1.8b": {
    ...createDefaultModelConfig(),
    label: "InternLM 2.5 1.8B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-internlm2_5-1_8b-chat",
    hfFilePath: "model.shard-00001-of-00008.gguf",
    fileSizeInMegabytes: 1120,
  },
  "qwen-3-1.7b": {
    ...createDefaultModelConfig(),
    label: "Qwen 3 1.7B",
    hfRepoId: "Felladrin/gguf-sharded-UD-Q4_K_XL-Qwen3-1.7B",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 1140,
  },
  "granite-3.3-2b": {
    ...createDefaultModelConfig(),
    label: "Granite 3.3 2B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-granite-3.3-2b-instruct",
    hfFilePath: "model.shard-00001-of-00019.gguf",
    fileSizeInMegabytes: 1460,
  },
  "exaone-3.5-2.4b": {
    ...createDefaultModelConfig(),
    label: "EXAONE 3.5 2.4B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-EXAONE-3.5-2.4B-Instruct",
    hfFilePath: "model.shard-00001-of-00008.gguf",
    fileSizeInMegabytes: 1580,
  },
  "gemma-2-2b": {
    ...createDefaultModelConfig(),
    label: "Gemma 2 2B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-gemma-2-2b-it",
    hfFilePath: "model.shard-00001-of-00004.gguf",
    fileSizeInMegabytes: 1640,
  },
  "megrez-3b": {
    ...createDefaultModelConfig(),
    label: "Megrez 3B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Megrez-3B-Instruct",
    hfFilePath: "model.shard-00001-of-00007.gguf",
    fileSizeInMegabytes: 1740,
  },
  "smollm3-3b": {
    ...createDefaultModelConfig(),
    label: "SmolLM 3 3B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-SmolLM3-3B",
    hfFilePath: "model.shard-00001-of-00009.gguf",
    fileSizeInMegabytes: 1820,
  },
  "granite-3.1-3b": {
    ...createDefaultModelConfig(),
    label: "Granite 3.1 3B [800M]",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-granite-3.1-3b-a800m-instruct",
    hfFilePath: "model.shard-00001-of-00033.gguf",
    fileSizeInMegabytes: 1900,
  },
  "falcon-3-3b": {
    ...createDefaultModelConfig(),
    label: "Falcon 3 3B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Falcon3-3B-Instruct",
    hfFilePath: "model.shard-00001-of-00006.gguf",
    fileSizeInMegabytes: 1930,
  },
  "llama-3.2-3b": {
    ...createDefaultModelConfig(),
    label: "Llama 3.2 3B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Llama-3.2-3B-Instruct",
    hfFilePath: "model.shard-00001-of-00007.gguf",
    fileSizeInMegabytes: 1930,
  },
  "phi-3.5-mini-3.8b": {
    ...createDefaultModelConfig(),
    label: "Phi 3.5 Mini 3.8B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Phi-3.5-mini-instruct",
    hfFilePath: "model.shard-00001-of-00034.gguf",
    fileSizeInMegabytes: 2190,
  },
  "gemma-3-4b": {
    ...createDefaultModelConfig(),
    label: "Gemma 3 4B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-gemma-3-4b-it",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 2380,
  },
  "polaris-4b-preview": {
    ...createDefaultModelConfig(),
    label: "Polaris 4B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Polaris-4B-Preview",
    hfFilePath: "model.shard-00001-of-00008.gguf",
    fileSizeInMegabytes: 2380,
  },
  "phi-4-mini-reasoning": {
    ...createDefaultModelConfig(),
    label: "Phi 4 Mini Reasoning 3.8B",
    hfRepoId: "Felladrin/gguf-sharded-UD-Q4_K_XL-Phi-4-mini-reasoning",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 2460,
  },
  "llama-3.1-nemotron-nano-4b": {
    ...createDefaultModelConfig(),
    label: "Llama 3.1 Nemotron Nano 4B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Llama-3.1-Nemotron-Nano-4B-v1.1",
    hfFilePath: "model.shard-00001-of-00009.gguf",
    fileSizeInMegabytes: 2660,
  },
  "gemma-3n-e2b": {
    ...createDefaultModelConfig(),
    label: "Gemma 3n E2B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-gemma-3n-E2B-it",
    hfFilePath: "model.shard-00001-of-00004.gguf",
    fileSizeInMegabytes: 2730,
    contextSize: 3328,
  },
};
