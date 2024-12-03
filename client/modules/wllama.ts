import { Template } from "@huggingface/jinja";
import {
  type LoadModelConfig,
  type SamplingConfig,
  Wllama,
  type WllamaConfig,
} from "@wllama/wllama/esm";
import type CacheManager from "@wllama/wllama/esm/cache-manager";
import type {
  CacheEntry,
  CacheEntryMetadata,
  DownloadOptions,
} from "@wllama/wllama/esm/cache-manager";
import multiThreadWllamaWasmUrl from "@wllama/wllama/esm/multi-thread/wllama.wasm?url";
import singleThreadWllamaWasmUrl from "@wllama/wllama/esm/single-thread/wllama.wasm?url";
import { addLogEntry } from "./logEntries";
import { getSettings } from "./pubSub";
import { getSystemPrompt } from "./systemPrompt";
import { defaultContextSize } from "./textGenerationUtilities";

export async function initializeWllama(
  hfRepoId: string,
  hfFilePath: string,
  config?: {
    wllama?: WllamaConfig;
    model?: LoadModelConfig & DownloadOptions;
  },
) {
  addLogEntry("Initializing Wllama");

  const wllama = new Wllama(
    {
      "single-thread/wllama.wasm": singleThreadWllamaWasmUrl,
      "multi-thread/wllama.wasm": multiThreadWllamaWasmUrl,
    },
    config?.wllama,
  );

  wllama.cacheManager = new CustomCacheManager("wllama-cache");

  await wllama.loadModelFromHF(hfRepoId, hfFilePath, config?.model);

  addLogEntry("Wllama initialized successfully");

  return wllama;
}

export interface WllamaModel {
  label: string;
  hfRepoId: string;
  hfFilePath: string;
  cacheTypeK: "f32" | "f16" | "q8_0" | "q5_1" | "q5_0" | "q4_1" | "q4_0";
  cacheTypeV: "f32" | "f16" | "q8_0" | "q5_1" | "q5_0" | "q4_1" | "q4_0";
  contextSize: number;
  fileSizeInMegabytes: number;
  getSampling: () => SamplingConfig;
  shouldIncludeUrlsOnPrompt: boolean;
  buildPrompt: (
    wllama: Wllama,
    query: string,
    searchResults: string,
  ) => Promise<string>;
  stopStrings?: string[];
  stopTokens?: number[];
}

const defaultModelConfig: Omit<
  WllamaModel,
  "label" | "fileSizeInMegabytes" | "hfRepoId" | "hfFilePath"
> = {
  buildPrompt: async (wllama, query, searchResults) => {
    return formatChat(wllama, [
      { id: 1, role: "user", content: getSystemPrompt(searchResults) },
      { id: 2, role: "assistant", content: "Ok!" },
      { id: 3, role: "user", content: query },
    ]);
  },
  cacheTypeK: "q4_0",
  cacheTypeV: "q8_0",
  contextSize: defaultContextSize,
  shouldIncludeUrlsOnPrompt: true,
  getSampling: () => {
    const settings = getSettings();
    return {
      top_p: settings.inferenceTopP,
      temp: settings.inferenceTemperature,
      penalty_freq: settings.inferenceFrequencyPenalty,
      penalty_present: settings.inferencePresencePenalty,
      min_p: 1 - settings.inferenceTopP,
      top_k: 0,
    };
  },
};

export const wllamaModels: Record<string, WllamaModel> = {
  "smollm2-135m": {
    ...defaultModelConfig,
    label: "SmolLM 2 135M",
    hfRepoId: "Felladrin/gguf-Q8_0-SmolLM2-135M-Instruct",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 145,
  },
  "smollm2-360m": {
    ...defaultModelConfig,
    label: "SmolLM 2 360M",
    hfRepoId: "Felladrin/gguf-Q8_0-SmolLM2-360M-Instruct",
    hfFilePath: "model.shard-00001-of-00008.gguf",
    fileSizeInMegabytes: 386,
  },
  "qwen-2.5-0.5b": {
    ...defaultModelConfig,
    label: "Qwen 2.5 0.5B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Qwen2.5-0.5B-Instruct",
    hfFilePath: "model.shard-00001-of-00003.gguf",
    fileSizeInMegabytes: 386,
  },
  "danube-3-500m": {
    ...defaultModelConfig,
    label: "Danube 3 500M",
    hfRepoId: "Felladrin/gguf-sharded-Q5_K_L-h2o-danube3-500m-chat",
    hfFilePath: "model.shard-00001-of-00008.gguf",
    fileSizeInMegabytes: 547,
  },
  "amd-olmo-1b": {
    ...defaultModelConfig,
    label: "AMD OLMo 1B",
    hfRepoId: "Felladrin/gguf-Q5_K_L-AMD-OLMo-1B-SFT-DPO",
    hfFilePath: "model.shard-00001-of-00009.gguf",
    fileSizeInMegabytes: 872,
  },
  "granite-3.0-1b": {
    ...defaultModelConfig,
    label: "Granite 3.0 1B [400M]",
    hfRepoId: "Felladrin/gguf-sharded-q5_k_l-granite-3.0-1b-a400m-instruct",
    hfFilePath: "model.shard-00001-of-00019.gguf",
    fileSizeInMegabytes: 969,
    buildPrompt: async (_, query, searchResults) =>
      buildGranitePrompt(query, searchResults),
  },
  "llama-3.2-1b": {
    ...defaultModelConfig,
    label: "Llama 3.2 1B",
    hfRepoId: "Felladrin/gguf-sharded-Q5_K_L-Llama-3.2-1B-Instruct",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 975,
  },
  "pythia-1.4b": {
    ...defaultModelConfig,
    label: "Pythia 1.4B",
    hfRepoId: "Felladrin/gguf-sharded-pythia-1.4b-sft-full",
    hfFilePath: "pythia-1.4b-sft-full.Q5_K_M.shard-00001-of-00011.gguf",
    fileSizeInMegabytes: 1060,
  },
  "pints-1.5b": {
    ...defaultModelConfig,
    label: "Pints 1.5B",
    hfRepoId: "Felladrin/gguf-sharded-Q5_K-1.5-Pints-2K-v0.1",
    hfFilePath: "model.shard-00001-of-00018.gguf",
    fileSizeInMegabytes: 1150,
  },
  "smollm2-1.7b": {
    ...defaultModelConfig,
    label: "SmolLM 2 1.7B",
    hfRepoId: "Felladrin/gguf-Q5_K_M-SmolLM2-1.7B-Instruct",
    hfFilePath: "model.shard-00001-of-00016.gguf",
    fileSizeInMegabytes: 1230,
  },
  "arcee-lite": {
    ...defaultModelConfig,
    label: "Arcee Lite 1.5B",
    hfRepoId: "Felladrin/gguf-q5_k_l-imat-arcee-lite",
    hfFilePath: "arcee-lite-Q5_K_L.shard-00001-of-00006.gguf",
    fileSizeInMegabytes: 1430,
  },
  "granite-3.0-2b": {
    ...defaultModelConfig,
    label: "Granite 3.0 2B",
    hfRepoId: "Felladrin/gguf-q5_k_m-granite-3.0-2b-instruct",
    hfFilePath: "granite-3-00001-of-00023.gguf",
    fileSizeInMegabytes: 1870,
    buildPrompt: async (_, query, searchResults) =>
      buildGranitePrompt(query, searchResults),
  },
  "gemma-2-2b": {
    ...defaultModelConfig,
    label: "Gemma 2 2B",
    hfRepoId: "Felladrin/gguf-sharded-gemma-2-2b-it-abliterated",
    hfFilePath: "gemma-2-2b-it-abliterated-q5_k_m-imat-00001-of-00009.gguf",
    fileSizeInMegabytes: 1920,
  },
  "llama-3.2-3b": {
    ...defaultModelConfig,
    label: "Llama 3.2 3B",
    hfRepoId: "Felladrin/gguf-sharded-Q5_K_L-Llama-3.2-3B-Instruct",
    hfFilePath: "model.shard-00001-of-00007.gguf",
    fileSizeInMegabytes: 2420,
  },
  "granite-3.0-3b": {
    ...defaultModelConfig,
    label: "Granite 3.0 3B [800M]",
    hfRepoId: "Felladrin/gguf-sharded-Q5_K_L-granite-3.0-3b-a800m-instruct",
    hfFilePath: "model.shard-00001-of-00034.gguf",
    fileSizeInMegabytes: 2450,
    buildPrompt: async (_, query, searchResults) =>
      buildGranitePrompt(query, searchResults),
  },
  "minicpm3-4b": {
    ...defaultModelConfig,
    label: "MiniCPM 3 4B",
    hfRepoId: "Felladrin/gguf-Q4_K_M-MiniCPM3-4B",
    hfFilePath: "model.shard-00001-of-00017.gguf",
    fileSizeInMegabytes: 2470,
    contextSize: 2496,
  },
  "phi-3.5-mini-3.8b": {
    ...defaultModelConfig,
    label: "Phi 3.5 Mini 3.8B",
    hfRepoId: "Felladrin/gguf-q5_k_m-phi-3.5-mini-instruct",
    hfFilePath: "phi-3-00001-of-00025.gguf",
    fileSizeInMegabytes: 2820,
    contextSize: 3584,
  },
  "magpielm-4b": {
    ...defaultModelConfig,
    label: "MagpieLM 4B",
    hfRepoId: "Felladrin/gguf-Q5_K_M-MagpieLM-4B-Chat-v0.1",
    hfFilePath: "magpielm-4b-chat-v0-00001-of-00019.gguf",
    fileSizeInMegabytes: 3230,
  },
  "nemotron-mini-4b": {
    ...defaultModelConfig,
    label: "Nemotron Mini 4B",
    hfRepoId: "Felladrin/gguf-Q5_K_M-Nemotron-Mini-4B-Instruct",
    hfFilePath: "nemotron-mini-4b-instruct-q5_k_m-imat-00001-of-00004.gguf",
    fileSizeInMegabytes: 3550,
  },
  "olmoe-1b-7b": {
    ...defaultModelConfig,
    label: "OLMoE 7B [1B]",
    hfRepoId: "Felladrin/gguf-sharded-Q3_K_XL-OLMoE-1B-7B-0924-Instruct",
    hfFilePath: "OLMoE-1B-7B-0924-Instruct-Q3_K_XL.shard-00001-of-00050.gguf",
    fileSizeInMegabytes: 3700,
    contextSize: 3584,
  },
};

function buildGranitePrompt(query: string, searchResults: string) {
  return `<|start_of_role|>system<|end_of_role|>${getSystemPrompt(
    searchResults,
  )}<|end_of_text|>
<|start_of_role|>user<|end_of_role|>${query}<|end_of_text|>
<|start_of_role|>assistant<|end_of_role|>`;
}

export interface Message {
  id: number;
  content: string;
  role: "system" | "user" | "assistant";
}

export const formatChat = async (wllama: Wllama, messages: Message[]) => {
  const defaultChatTemplate =
    "{% for message in messages %}{{'<|im_start|>' + message['role'] + '\n' + message['content'] + '<|im_end|>' + '\n'}}{% endfor %}{% if add_generation_prompt %}{{ '<|im_start|>assistant\n' }}{% endif %}";

  const template = new Template(
    wllama.getChatTemplate() ?? defaultChatTemplate,
  );

  const textDecoder = new TextDecoder();

  return template.render({
    messages,
    bos_token: textDecoder.decode(await wllama.detokenize([wllama.getBOS()])),
    eos_token: textDecoder.decode(await wllama.detokenize([wllama.getEOS()])),
    add_generation_prompt: true,
  });
};

class CustomCacheManager implements CacheManager {
  private readonly cacheName: string;

  constructor(cacheName: string) {
    this.cacheName = cacheName;
  }

  async getNameFromURL(url: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const fileName = url.split("/").pop() || "default";
    return `${hashHex}_${fileName}`;
  }

  async write(
    name: string,
    stream: ReadableStream,
    metadata: CacheEntryMetadata,
  ): Promise<void> {
    const cache = await caches.open(this.cacheName);
    const response = new Response(stream, {
      headers: { "X-Metadata": JSON.stringify(metadata) },
    });
    await cache.put(name, response);
  }

  async open(name: string): Promise<Blob | null> {
    const cache = await caches.open(this.cacheName);
    const response = await cache.match(name);
    if (!response?.body) return null;
    return new Response(response.body).blob();
  }

  async getSize(name: string): Promise<number> {
    const cache = await caches.open(this.cacheName);
    const response = await cache.match(name);
    if (!response) return -1;
    return (
      Number(response.headers.get("Content-Length")) ||
      (await response.blob()).size
    );
  }

  async getMetadata(name: string): Promise<CacheEntryMetadata | null> {
    const cache = await caches.open(this.cacheName);
    const response = await cache.match(name);
    if (!response) return null;
    const metadata = response.headers.get("X-Metadata");
    return metadata ? JSON.parse(metadata) : null;
  }

  async list(): Promise<CacheEntry[]> {
    const cache = await caches.open(this.cacheName);
    const keys = await cache.keys();
    return Promise.all(
      keys.map(async (request) => {
        const response = await cache.match(request);
        if (!response) throw new Error(`No response for ${request.url}`);
        const metadata = await this.getMetadata(request.url);
        const size = await this.getSize(request.url);
        return {
          name: request.url,
          size,
          metadata: metadata ?? { etag: "", originalSize: 0, originalURL: "" },
        };
      }),
    );
  }

  async clear(): Promise<void> {
    await caches.delete(this.cacheName);
  }

  async delete(nameOrURL: string): Promise<void> {
    const cache = await caches.open(this.cacheName);
    const success = await cache.delete(nameOrURL);
    if (!success) {
      throw new Error(`Failed to delete cache entry for ${nameOrURL}`);
    }
  }

  async deleteMany(predicate: (e: CacheEntry) => boolean): Promise<void> {
    const entries = await this.list();
    const cache = await caches.open(this.cacheName);
    const deletionPromises = entries
      .filter(predicate)
      .map((entry) => cache.delete(entry.name));
    await Promise.all(deletionPromises);
  }

  async writeMetadata(
    name: string,
    metadata: CacheEntryMetadata,
  ): Promise<void> {
    const cache = await caches.open(this.cacheName);
    const response = await cache.match(name);
    if (!response) {
      throw new Error(`Cache entry for ${name} not found`);
    }

    const newResponse = new Response(response.body, {
      headers: {
        ...response.headers,
        "X-Metadata": JSON.stringify(metadata),
      },
    });

    await cache.put(name, newResponse);
  }

  async download(url: string, options?: DownloadOptions): Promise<void> {
    const response = await fetch(url, options);
    if (!response.ok)
      throw new Error(`Failed to download: ${response.statusText}`);
    const name = await this.getNameFromURL(url);
    const metadata = {
      etag: response.headers.get("etag") || "",
      originalSize: Number(response.headers.get("content-length")) || 0,
      originalURL: url,
    };
    if (response.body) {
      await this.write(name, response.body, metadata);
    }
  }
}
