import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  updateModelLoadingProgress,
  updateModelSizeInMegabytes,
} from "./pubSub";
import { generateTextWithWllama } from "./textGenerationWithWllama";
import { initializeWllama } from "./wllama";

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));

vi.mock("./pubSub", () => ({
  getQuery: vi.fn().mockReturnValue("what is a cave?"),
  getSettings: vi.fn().mockReturnValue({
    enableAiResponse: true,
    wllamaModelId: "test-model",
    cpuThreads: 1,
  }),
  getTextGenerationState: vi.fn().mockReturnValue("generating"),
  updateModelLoadingProgress: vi.fn(),
  updateModelSizeInMegabytes: vi.fn(),
  updateResponse: vi.fn(),
  updateTextGenerationState: vi.fn(),
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

vi.mock("./webGpu", () => ({ isWebGPUAvailable: false }));

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

  it("keeps the last known size when the total is not available yet", async () => {
    mockDownload([{ loaded: 0, total: 0 }]);

    await generateTextWithWllama();

    expect(updateModelLoadingProgress).not.toHaveBeenCalled();
    expect(updateModelSizeInMegabytes).not.toHaveBeenCalledWith(0);
  });
});
