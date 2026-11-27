import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "./logEntries";
import { getDownloadedWllamaModelIds } from "./wllama";

const cache = vi.hoisted(() => ({
  getModels: vi.fn(),
  constructorThrows: false,
}));

vi.mock("@wllama/wllama", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // A constructor that returns an object hands that object to `new`.
  ModelManager: vi.fn(function ModelManager() {
    if (cache.constructorThrows) {
      throw new Error("No supported storage backend found");
    }
    return { getModels: cache.getModels };
  }),
}));
vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));
vi.mock("./textGenerationUtilities", () => ({ defaultContextSize: 4096 }));

/** A cached model as wllama reports it: its first-shard URL and its own verdict. */
function cachedModel(url: string, status: "valid" | "invalid" | "deleted") {
  return { url, validate: () => status };
}

const qwenUrl =
  "https://huggingface.co/Felladrin/gguf-sharded-UD-Q4_K_XL-Qwen3-0.6B/resolve/main/model.shard-00001-of-00004.gguf";
const gemmaUrl =
  "https://huggingface.co/Felladrin/gguf-sharded-Q4_K_S-gemma-3-270m-it/resolve/main/model.shard-00001-of-00002.gguf";

describe("getDownloadedWllamaModelIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.constructorThrows = false;
    cache.getModels.mockResolvedValue([]);
  });

  it("asks wllama for the incomplete models too, to judge them itself", async () => {
    await getDownloadedWllamaModelIds();

    expect(cache.getModels).toHaveBeenCalledWith({ includeInvalid: true });
  });

  it("returns the catalog id of a model whose files are all valid", async () => {
    cache.getModels.mockResolvedValue([cachedModel(qwenUrl, "valid")]);

    expect(await getDownloadedWllamaModelIds()).toEqual(
      new Set(["qwen-3-0.6b"]),
    );
  });

  it("leaves out a model whose download stopped halfway", async () => {
    cache.getModels.mockResolvedValue([cachedModel(gemmaUrl, "invalid")]);

    expect(await getDownloadedWllamaModelIds()).toEqual(new Set());
  });

  it("leaves out a model cached under another URL", async () => {
    cache.getModels.mockResolvedValue([
      // The second shard of a model, and a quant the catalog does not list:
      // neither is the URL MiniSearch loads a catalog entry with.
      cachedModel(
        "https://huggingface.co/Felladrin/gguf-sharded-Q4_K_S-gemma-3-270m-it/resolve/main/model.shard-00002-of-00002.gguf",
        "valid",
      ),
      cachedModel(
        "https://huggingface.co/Felladrin/gguf-sharded-Q8_0-Qwen3-0.6B/resolve/main/model.shard-00001-of-00004.gguf",
        "valid",
      ),
    ]);

    expect(await getDownloadedWllamaModelIds()).toEqual(new Set());
  });

  it("returns no ids and logs when reading the cache fails", async () => {
    cache.getModels.mockRejectedValue(new Error("OPFS is unavailable"));

    expect(await getDownloadedWllamaModelIds()).toEqual(new Set());
    expect(addLogEntry).toHaveBeenCalledWith(
      "Failed to read the Wllama model cache: OPFS is unavailable",
    );
  });

  it("returns no ids and logs when the browser has no cache to open", async () => {
    // ModelManager builds its CacheManager in its own constructor, so a browser
    // without OPFS fails before any model is read.
    cache.constructorThrows = true;

    expect(await getDownloadedWllamaModelIds()).toEqual(new Set());
    expect(addLogEntry).toHaveBeenCalledWith(
      "Failed to read the Wllama model cache: No supported storage backend found",
    );
  });
});
