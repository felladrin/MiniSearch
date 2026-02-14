import { beforeEach, describe, it, vi } from "vitest";
import {
  mockPubSub,
  mockTextGenerationUtilities,
  testTextGenerationBehavior,
} from "./testUtils";

// Mock dependencies
vi.mock("@root/package.json", () => ({
  repository: { url: "https://github.com/owner/repo" },
  version: "1.0.0",
}));
vi.mock("./pubSub", () => mockPubSub({ hordeModel: null }));
vi.mock("./textGenerationUtilities", () =>
  mockTextGenerationUtilities({
    getDefaultChatCompletionCreateParamsStreaming: vi.fn(),
  }),
);

describe("generateTextWithHorde", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls helpers and updates state", async () => {
    // Mock the module before importing
    vi.doMock("./textGenerationWithHorde", () => ({
      generateTextWithHorde: vi.fn().mockImplementation(async () => {
        const pubSub = await import("./pubSub");
        const utils = await import("./textGenerationUtilities");

        await utils.canStartResponding();
        pubSub.updateTextGenerationState("preparingToGenerate");
        pubSub.updateResponse("generated text");
      }),
      generateChatWithHorde: vi.fn(),
    }));

    const mod = await import("./textGenerationWithHorde");
    await testTextGenerationBehavior(
      () => mod.generateTextWithHorde(),
      "generated text",
    );
  });
});
