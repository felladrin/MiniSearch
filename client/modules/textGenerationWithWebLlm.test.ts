import { beforeEach, describe, it, vi } from "vitest";
import {
  mockPubSub,
  mockTextGenerationUtilities,
  testTextGenerationBehavior,
} from "./testUtils";

vi.stubGlobal("Worker", vi.fn());

vi.mock("./pubSub", () =>
  mockPubSub({
    enableAiResponse: true,
    webLlmModelId: "model-id",
  }),
);
vi.mock("./textGenerationUtilities", () =>
  mockTextGenerationUtilities({
    handleStreamingResponse: vi.fn(async (_completion, onUpdate) => {
      await onUpdate("partial");
      return "partial";
    }),
  }),
);

vi.mock("@mlc-ai/web-llm", () => ({
  CreateWebWorkerMLCEngine: vi.fn().mockResolvedValue({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({ fullStream: [] }),
      },
    },
    resetChat: vi.fn(),
    runtimeStatsText: vi.fn().mockResolvedValue("stats"),
    unload: vi.fn(),
  }),
  CreateMLCEngine: vi.fn(),
  hasModelInCache: vi.fn().mockResolvedValue(true),
  prebuiltAppConfig: {
    model_list: [{ model_id: "model-id", vram_required_MB: 1024 }],
  },
}));

import * as mod from "./textGenerationWithWebLlm";

describe("generateTextWithWebLlm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // biome-ignore lint/suspicious/noExplicitAny: Necessary for test mocking
    (mod as any).initializeWebLlmEngine = vi.fn().mockResolvedValue({
      chat: {
        completions: { create: vi.fn().mockResolvedValue("completion") },
      },
      runtimeStatsText: vi.fn().mockResolvedValue("stats"),
      unload: vi.fn(),
    });
  });

  it("calls helpers and updates state", async () => {
    await testTextGenerationBehavior(
      () => mod.generateTextWithWebLlm(),
      "partial",
    );
  });
});
