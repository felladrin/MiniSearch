import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  updateModelLoadingProgress,
  updateModelSizeInMegabytes,
  updateSettings,
} from "./pubSub";
import {
  composeStreamedText,
  generateChatWithWllama,
  generateTextWithWllama,
} from "./textGenerationWithWllama";
import { initializeWllama } from "./wllama";

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));

vi.mock("./pubSub", () => ({
  getQuery: vi.fn().mockReturnValue("what is a cave?"),
  getSettings: vi.fn().mockReturnValue({
    enableAiResponse: true,
    wllamaModelId: "test-model",
    cpuThreads: 1,
    reasoningStartMarker: "<think>",
    reasoningEndMarker: "</think>",
  }),
  getTextGenerationState: vi.fn().mockReturnValue("generating"),
  updateModelLoadingProgress: vi.fn(),
  updateModelSizeInMegabytes: vi.fn(),
  updateResponse: vi.fn(),
  updateSettings: vi.fn(),
  updateTextGenerationState: vi.fn(),
}));

vi.mock("./config", () => ({
  getConfig: vi.fn().mockResolvedValue({
    wllamaDefaultModelId: "test-model",
    wllamaDefaultGpuModelId: "test-gpu-model",
  }),
  FALLBACK_CONFIG: {
    wllamaDefaultModelId: "test-model",
    wllamaDefaultGpuModelId: "test-gpu-model",
  },
}));

vi.mock("./systemPrompt", () => ({
  getSystemPrompt: vi.fn().mockReturnValue("system"),
}));

vi.mock("./textGenerationUtilities", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./textGenerationUtilities")>();
  return {
    ...actual,
    canStartResponding: vi.fn().mockResolvedValue(undefined),
    getFormattedSearchResults: vi.fn().mockReturnValue("None."),
  };
});

vi.mock("./webGpu", () => ({ webGpuSupport: Promise.resolve(false) }));

const megabyte = 1024 * 1024;

vi.mock("./wllama", () => ({
  initializeWllama: vi.fn(),
  wllamaModels: {
    "test-model": {
      label: "Test Model",
      hfRepoId: "repo",
      hfFilePath: "model.gguf",
      contextSize: 512,
      // Deliberately different from the size the download reports, so the
      // assertions can tell the estimate apart from the measured size.
      fileSizeInMegabytes: 999,
      shouldIncludeUrlsOnPrompt: false,
      getSampling: () => ({}),
    },
    "stop-model": {
      label: "Stop Model",
      hfRepoId: "repo",
      hfFilePath: "stop.gguf",
      contextSize: 512,
      fileSizeInMegabytes: 1,
      shouldIncludeUrlsOnPrompt: false,
      getSampling: () => ({}),
      stopStrings: ["STOP", "<|end|>"],
    },
  },
}));

async function* singleChunkStream() {
  yield { choices: [{ delta: { content: "Hello" } }] };
}

/** Drives the download progress callback wllama would call while fetching. */
function mockDownload(steps: { loaded: number; total: number }[]) {
  vi.mocked(initializeWllama).mockImplementation(
    async (_repoId, _filePath, config) => {
      for (const step of steps) config?.model?.progressCallback?.(step);
      return {
        createChatCompletion: vi.fn().mockResolvedValue(singleChunkStream()),
        exit: vi.fn().mockResolvedValue(undefined),
        // biome-ignore lint/suspicious/noExplicitAny: minimal Wllama stub
      } as any;
    },
  );
}

describe("generateTextWithWllama", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the downloaded size alongside every progress update", async () => {
    mockDownload([
      { loaded: 50 * megabyte, total: 250 * megabyte },
      { loaded: 175 * megabyte, total: 250 * megabyte },
    ]);

    await generateTextWithWllama();

    expect(updateModelLoadingProgress).toHaveBeenCalledTimes(2);
    expect(updateModelLoadingProgress).toHaveBeenLastCalledWith(70);
    expect(vi.mocked(updateModelSizeInMegabytes).mock.calls).toEqual([
      [999], // catalog estimate, published before the download starts
      [250], // measured size, republished with each progress update
      [250],
    ]);
  });

  it("switches to the default model when the saved one left the catalog", async () => {
    const savedSettings = getSettings();
    vi.mocked(getSettings).mockReturnValue({
      ...savedSettings,
      wllamaModelId: "removed-model",
    });
    mockDownload([]);

    try {
      await generateTextWithWllama();
    } finally {
      vi.mocked(getSettings).mockReturnValue(savedSettings);
    }

    expect(vi.mocked(initializeWllama).mock.calls[0]?.[0]).toBe("repo");
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ wllamaModelId: "test-model" }),
    );
    expect(addLogEntry).toHaveBeenCalledWith(
      expect.stringContaining("removed-model"),
    );
  });

  it("uses the default model without saving it when the server config cannot be loaded", async () => {
    const savedSettings = getSettings();
    vi.mocked(getSettings).mockReturnValue({
      ...savedSettings,
      wllamaModelId: "removed-model",
    });
    const serverConfig = await getConfig();
    vi.mocked(getConfig).mockRejectedValue(new Error("Network error"));
    mockDownload([]);

    try {
      await generateTextWithWllama();
    } finally {
      vi.mocked(getSettings).mockReturnValue(savedSettings);
      vi.mocked(getConfig).mockResolvedValue(serverConfig);
    }

    expect(vi.mocked(initializeWllama).mock.calls[0]?.[0]).toBe("repo");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("keeps the last known size when the total is not available yet", async () => {
    mockDownload([{ loaded: 0, total: 0 }]);

    await generateTextWithWllama();

    expect(updateModelLoadingProgress).not.toHaveBeenCalled();
    expect(updateModelSizeInMegabytes).not.toHaveBeenCalledWith(0);
  });
});

describe("stop strings", () => {
  async function streamWithStopModel(chunks: string[]) {
    const savedSettings = getSettings();
    vi.mocked(getSettings).mockReturnValue({
      ...savedSettings,
      wllamaModelId: "stop-model",
    });
    vi.mocked(initializeWllama).mockImplementation(
      async () =>
        ({
          createChatCompletion: vi.fn().mockResolvedValue(
            (async function* () {
              for (const content of chunks) {
                yield { choices: [{ delta: { content } }] };
              }
            })(),
          ),
          exit: vi.fn().mockResolvedValue(undefined),
          // biome-ignore lint/suspicious/noExplicitAny: minimal Wllama stub
        }) as any,
    );
    const onUpdate = vi.fn();

    try {
      const result = await generateChatWithWllama(
        [{ role: "user", content: "hi" }],
        onUpdate,
      );
      return { result, onUpdate };
    } finally {
      vi.mocked(getSettings).mockReturnValue(savedSettings);
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cuts at the stop string when text follows it in the same chunk", async () => {
    const { result, onUpdate } = await streamWithStopModel([
      "abcdefghijklSTOPxyz",
    ]);

    expect(result).toBe("abcdefghijkl");
    expect(onUpdate).toHaveBeenLastCalledWith("abcdefghijkl");
  });

  it("removes a stop string that ends the text", async () => {
    const { result } = await streamWithStopModel(["Hello ", "world", "STOP"]);

    expect(result).toBe("Hello world");
  });

  it("cuts at the stop string that is found, not at the first one in the list", async () => {
    const { result } = await streamWithStopModel(["answer<|end|>tail"]);

    expect(result).toBe("answer");
  });

  it("leaves the text alone when no stop string appears", async () => {
    const { result } = await streamWithStopModel(["no stop ", "here"]);

    expect(result).toBe("no stop here");
  });
});

describe("composeStreamedText", () => {
  it("returns the answer unchanged when the model does not think", () => {
    expect(composeStreamedText("", "The answer.")).toBe("The answer.");
  });

  it("keeps the reasoning open while the answer has not started", () => {
    expect(composeStreamedText("hmm, let me see", "")).toBe(
      "<think>hmm, let me see",
    );
  });

  it("closes the reasoning block when the answer starts", () => {
    expect(composeStreamedText("done thinking", "The answer.")).toBe(
      "<think>done thinking</think>The answer.",
    );
  });
});
