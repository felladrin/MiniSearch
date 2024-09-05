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

  wllama.cacheManager = new CustomCacheManager("wllama-cache");

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

export interface WllamaModel {
  label: string;
  url: string | string[];
  cacheType: "f16" | "q8_0" | "q4_0";
  contextSize: number;
  sampling: SamplingConfig;
  shouldIncludeUrlsOnPrompt: boolean;
  buildPrompt: (
    wllama: Wllama,
    query: string,
    searchResults: string,
  ) => Promise<string>;
}

export const wllamaModels: Record<string, WllamaModel> = {
  "smollm-360M-instruct": {
    label: "SmolLM 360M Instruct • 290 MB",
    url: "https://huggingface.co/Felladrin/gguf-Q5_K_M-smollm-360M-instruct-add-basics/resolve/main/smollm-360m-instruct-add-basics-q5_k_m-imat-00001-of-00005.gguf",
    buildPrompt: (wllama, query, searchResults) =>
      formatChat(wllama, [
        {
          id: 0,
          role: "system",
          content: `You are an AI assistant tasked with answering questions based on provided web search results and a user inquiry. Analyze the search results and use them as background information if relevant to the inquiry, but you may disregard them if they don't contribute to answering the question.

Web search results:
${"```"}
${searchResults}  
${"```"}

Please answer the user's inquiry based on the information provided or your general knowledge if the search results are not relevant. Include additional context or related information that might be useful or interesting to the user, even if not directly asked for in the inquiry. Always respond in the same language used by the user in their inquiry.`,
        },
        { id: 1, role: "user", content: query },
      ]),
    cacheType: "f16",
    contextSize: 1280,
    shouldIncludeUrlsOnPrompt: false,
    sampling: commonSamplingConfig,
  },
  "arcee-lite": {
    label: "Arcee Lite • 1.43 GB",
    url: "https://huggingface.co/Felladrin/gguf-q5_k_l-imat-arcee-lite/resolve/main/arcee-lite-Q5_K_L.shard-00001-of-00006.gguf",
    buildPrompt: (wllama, query, searchResults) =>
      formatChat(wllama, [
        {
          id: 0,
          role: "system",
          content: `You are an AI assistant tasked with answering questions based on provided web search results and a user inquiry. Analyze the search results and use them as background information if relevant to the inquiry, but you may disregard them if they don't contribute to answering the question.

Web search results:  
${"```"}
${searchResults}
${"```"}

Please answer the user's inquiry based on the information provided or your general knowledge if the search results are not relevant. Include additional context or related information that might be useful or interesting to the user, even if not directly asked for in the inquiry. Always respond in the same language used by the user in their inquiry.`,
        },
        { id: 1, role: "user", content: query },
      ]),
    cacheType: "f16",
    contextSize: 1280,
    shouldIncludeUrlsOnPrompt: false,
    sampling: commonSamplingConfig,
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

  return template.render({
    messages,
    bos_token: await wllama.detokenize([wllama.getBOS()]),
    eos_token: await wllama.detokenize([wllama.getEOS()]),
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
