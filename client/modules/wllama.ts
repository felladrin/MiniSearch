import {
  DownloadModelConfig,
  Wllama,
  WllamaConfig,
  SamplingConfig,
} from "@wllama/wllama/esm";
import CacheManager, {
  CacheEntry,
  CacheEntryMetadata,
} from "@wllama/wllama/esm/cache-manager";
import singleThreadWllamaJsUrl from "@wllama/wllama/esm/single-thread/wllama.js?url";
import singleThreadWllamaWasmUrl from "@wllama/wllama/esm/single-thread/wllama.wasm?url";
import multiThreadWllamaJsUrl from "@wllama/wllama/esm/multi-thread/wllama.js?url";
import multiThreadWllamaWasmUrl from "@wllama/wllama/esm/multi-thread/wllama.wasm?url";
import multiThreadWllamaWorkerMjsUrl from "@wllama/wllama/esm/multi-thread/wllama.worker.mjs?url";
import { Template } from "@huggingface/jinja";
import { getSystemPrompt } from "./systemPrompt";
import { addLogEntry } from "./logEntries";
import { defaultSettings } from "./settings";

export async function initializeWllama(
  modelUrl: string | string[],
  config?: {
    wllama?: WllamaConfig;
    model?: DownloadModelConfig;
  },
) {
  addLogEntry("Initializing Wllama");

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

  wllama.cacheManager = new CustomCacheManager("wllama-cache");

  await wllama.loadModelFromUrl(modelUrl, config?.model);

  addLogEntry("Wllama initialized successfully");

  return wllama;
}

export interface WllamaModel {
  label: string;
  url: string | string[];
  cacheType: "f16" | "q8_0" | "q4_0";
  contextSize: number;
  fileSizeInMegabytes: number;
  sampling: SamplingConfig;
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
  "label" | "url" | "fileSizeInMegabytes"
> = {
  buildPrompt: async (wllama, query, searchResults) => {
    return formatChat(wllama, [
      { id: 1, role: "user", content: getSystemPrompt(searchResults) },
      { id: 2, role: "assistant", content: "Ok!" },
      { id: 3, role: "user", content: query },
    ]);
  },
  cacheType: "f16",
  contextSize: 2048,
  shouldIncludeUrlsOnPrompt: true,
  sampling: {
    temp: defaultSettings.inferenceTemperature,
    penalty_repeat: defaultSettings.inferenceRepeatPenalty,
    min_p: 0.02,
    // @ts-expect-error Wllama still doesn't have the following properties defined, although they are supported by the llama.cpp backend.
    sampling_seq: "mx",
    xtc_probability: 0.5,
  },
};

export const wllamaModels: Record<string, WllamaModel> = {
  "smollm-135m": {
    ...defaultModelConfig,
    label: "SmolLM 135M",
    url: "https://huggingface.co/Felladrin/gguf-Q8_0-smollm-135M-instruct-v0.2/resolve/main/smollm-135m-instruct-add-basics-q8_0.gguf",
    fileSizeInMegabytes: 145,
  },
  "smollm-360m": {
    ...defaultModelConfig,
    label: "SmolLM 360M",
    url: "https://huggingface.co/Felladrin/gguf-Q5_K_M-smollm-360M-instruct-add-basics/resolve/main/smollm-360m-instruct-add-basics-q5_k_m-imat-00001-of-00005.gguf",
    fileSizeInMegabytes: 290,
  },
  "danube-3-500m": {
    ...defaultModelConfig,
    label: "Danube 3 500M",
    url: "https://huggingface.co/Felladrin/gguf-q5_k_m-h2o-danube3-500m-chat/resolve/main/h2o-danube3-500m-chat-q5_k_m-imat-00001-of-00003.gguf",
    fileSizeInMegabytes: 368,
  },
  "qwen-2.5-0.5b": {
    ...defaultModelConfig,
    label: "Qwen 2.5 0.5B",
    url: "https://huggingface.co/Felladrin/gguf-Q5_K_M-Qwen2.5-0.5B-Instruct/resolve/main/qwen2-00001-of-00003.gguf",
    fileSizeInMegabytes: 420,
  },
  "llama-3.2-1b": {
    ...defaultModelConfig,
    label: "Llama 3.2 1B",
    url: "https://huggingface.co/Felladrin/gguf-sharded-Q5_K_L-Llama-3.2-1B-Instruct/resolve/main/model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 975,
  },
  "pints-1.5b": {
    ...defaultModelConfig,
    label: "Pints 1.5B",
    url: "https://huggingface.co/Felladrin/gguf-sharded-Q5_K-1.5-Pints-2K-v0.1/resolve/main/model.shard-00001-of-00018.gguf",
    fileSizeInMegabytes: 1150,
  },
  "arcee-lite": {
    ...defaultModelConfig,
    label: "Arcee Lite 1.5B",
    url: "https://huggingface.co/Felladrin/gguf-q5_k_l-imat-arcee-lite/resolve/main/arcee-lite-Q5_K_L.shard-00001-of-00006.gguf",
    fileSizeInMegabytes: 1430,
  },
  "danube2-1.8b": {
    ...defaultModelConfig,
    label: "Danube 2 1.8B",
    url: "https://huggingface.co/Felladrin/gguf-q5_k_m-h2o-danube2-1.8b-chat/resolve/main/h2o-danube2-1-00001-of-00021.gguf",
    fileSizeInMegabytes: 1300,
  },
  "granite-3.0-2b": {
    ...defaultModelConfig,
    label: "Granite 3.0 2B",
    url: "https://huggingface.co/Felladrin/gguf-q5_k_m-granite-3.0-2b-instruct/resolve/main/granite-3-00001-of-00023.gguf",
    fileSizeInMegabytes: 1870,
    buildPrompt: async (_, query, searchResults) => {
      return `<|start_of_role|>system<|end_of_role|>${getSystemPrompt(searchResults)}<|end_of_text|>
<|start_of_role|>user<|end_of_role|>${query}<|end_of_text|>`;
    },
  },
  "gemma-2-2b": {
    ...defaultModelConfig,
    label: "Gemma 2 2B",
    url: "https://huggingface.co/Felladrin/gguf-sharded-gemma-2-2b-it-abliterated/resolve/main/gemma-2-2b-it-abliterated-q5_k_m-imat-00001-of-00009.gguf",
    fileSizeInMegabytes: 1920,
  },
  "llama-3.2-3b": {
    ...defaultModelConfig,
    label: "Llama 3.2 3B",
    url: "https://huggingface.co/Felladrin/gguf-sharded-Q5_K_L-Llama-3.2-3B-Instruct/resolve/main/model.shard-00001-of-00007.gguf",
    fileSizeInMegabytes: 2420,
  },
  "phi-3.5-mini-3.8b": {
    ...defaultModelConfig,
    label: "Phi 3.5 Mini 3.8B",
    url: "https://huggingface.co/Felladrin/gguf-q5_k_m-phi-3.5-mini-instruct/resolve/main/phi-3-00001-of-00025.gguf",
    fileSizeInMegabytes: 2820,
  },
  "magpielm-4b": {
    ...defaultModelConfig,
    label: "MagpieLM 4B",
    url: "https://huggingface.co/Felladrin/gguf-Q5_K_M-MagpieLM-4B-Chat-v0.1/resolve/main/magpielm-4b-chat-v0-00001-of-00019.gguf",
    fileSizeInMegabytes: 3230,
  },
  "nemotron-mini-4b": {
    ...defaultModelConfig,
    label: "Nemotron Mini 4B",
    url: "https://huggingface.co/Felladrin/gguf-Q5_K_M-Nemotron-Mini-4B-Instruct/resolve/main/nemotron-mini-4b-instruct-q5_k_m-imat-00001-of-00004.gguf",
    fileSizeInMegabytes: 3550,
  },
  "olmoe-1b-7b": {
    ...defaultModelConfig,
    label: "OLMoE 1B 7B",
    url: "https://huggingface.co/Felladrin/gguf-sharded-Q3_K_XL-OLMoE-1B-7B-0924-Instruct/resolve/main/OLMoE-1B-7B-0924-Instruct-Q3_K_XL.shard-00001-of-00050.gguf",
    fileSizeInMegabytes: 3700,
  },
};

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

  async open(name: string): Promise<ReadableStream | null> {
    const cache = await caches.open(this.cacheName);
    const response = await cache.match(name);
    return response?.body ?? null;
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
}
