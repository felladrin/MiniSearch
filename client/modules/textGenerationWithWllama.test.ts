import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  updateGenerationRate,
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
  updateGenerationRate: vi.fn(),
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

vi.mock("./textGenerationUtilities", async (importOriginal) =>
  (await import("./textGenerationTestUtils")).textGenerationUtilitiesMock()(
    importOriginal,
  ),
);

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

    await expect(generateTextWithWllama()).resolves.toBe("Hello");

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

describe("browser-model sessions", () => {
  beforeEach(() => {
    // clearAllMocks, not resetAllMocks: the module mocks above carry their
    // implementations in their factories, and resetting would drop them.
    vi.clearAllMocks();
  });

  /**
   * A model that counts how many instances are open at once and holds each
   * generation until the test releases it, so an overlap is observable. An
   * instance counts as open from its creation until its `exit`.
   */
  function trackOpenInstances() {
    let open = 0;
    let maxOpen = 0;
    const releases: (() => void)[] = [];

    vi.mocked(initializeWllama).mockImplementation(async () => {
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      return {
        createChatCompletion: vi.fn().mockImplementation(async () => {
          await new Promise<void>((resolve) => releases.push(resolve));
          return singleChunkStream();
        }),
        exit: vi.fn().mockImplementation(async () => {
          open -= 1;
        }),
        // biome-ignore lint/suspicious/noExplicitAny: minimal Wllama stub
      } as any;
    });

    return { releases, maxOpen: () => maxOpen };
  }

  it("opens one model instance when a search and a chat run at once", async () => {
    const { releases, maxOpen } = trackOpenInstances();
    const order: string[] = [];

    const search = generateTextWithWllama().then((answer) => {
      order.push("search");
      return answer;
    });
    const chat = generateChatWithWllama(
      [{ role: "user", content: "hi" }],
      vi.fn(),
    ).then((answer) => {
      order.push("chat");
      return answer;
    });

    // Only the first caller reached the model; the chat is waiting its turn.
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    expect(maxOpen()).toBe(1);

    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();

    await expect(Promise.all([search, chat])).resolves.toEqual([
      "Hello",
      "Hello",
    ]);
    // FIFO, not just one-at-a-time: the first caller finishes first.
    expect(order).toEqual(["search", "chat"]);
    expect(maxOpen()).toBe(1);
  });

  it("releases the turn when a load fails while another caller is queued", async () => {
    vi.mocked(initializeWllama).mockRejectedValueOnce(new Error("load failed"));
    mockDownload([]);

    const failing = generateTextWithWllama();
    const queued = generateChatWithWllama(
      [{ role: "user", content: "hi" }],
      vi.fn(),
    );

    await expect(failing).rejects.toThrow("load failed");
    await expect(queued).resolves.toBe("Hello");
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

describe("generation speed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Streams `chunks`, each one arriving at its own moment on a clock the test
   * owns, and answers with the speed the run published.
   */
  async function streamOnClock(
    chunks: {
      delta: Record<string, string>;
      at: number;
      timings?: { predicted_per_second: number };
    }[],
    signal?: AbortSignal,
    onChunk?: () => void,
  ) {
    let now = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.mocked(initializeWllama).mockImplementation(
      async () =>
        ({
          createChatCompletion: vi.fn().mockResolvedValue(
            (async function* () {
              for (const { delta, at, timings } of chunks) {
                now = at;
                yield { choices: [{ delta }], timings };
                onChunk?.();
              }
            })(),
          ),
          exit: vi.fn().mockResolvedValue(undefined),
          // biome-ignore lint/suspicious/noExplicitAny: minimal Wllama stub
        }) as any,
    );

    try {
      await generateTextWithWllama(signal);
      return vi.mocked(updateGenerationRate).mock.calls.at(-1)?.[0];
    } finally {
      nowSpy.mockRestore();
    }
  }

  it("publishes llama.cpp's own decode speed from the last chunk", async () => {
    const rate = await streamOnClock([
      { delta: { content: "The" }, at: 0 },
      { delta: { reasoning_content: "hmm" }, at: 1000 },
      { delta: { content: "answer" }, at: 2000 },
      // The last chunk carries no text, only the timings.
      { delta: {}, at: 4000, timings: { predicted_per_second: 23.77 } },
    ]);

    expect(rate).toBe("23.8 tokens/s");
  });

  it("publishes nothing when the engine reports no timings", async () => {
    const rate = await streamOnClock([
      { delta: { content: "The" }, at: 0 },
      { delta: { content: "answer" }, at: 2000 },
    ]);

    // A chunk is not always one token, so counting chunks would be a guess.
    expect(rate).toBeUndefined();
  });

  it("publishes nothing when the answer is interrupted", async () => {
    const controller = new AbortController();

    await expect(
      streamOnClock(
        [
          { delta: { content: "an" }, at: 0 },
          { delta: { content: "swer" }, at: 1000 },
        ],
        controller.signal,
        () => controller.abort(),
      ),
    ).rejects.toThrow("Chat generation interrupted");

    expect(updateGenerationRate).not.toHaveBeenCalled();
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
