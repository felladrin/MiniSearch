import { beforeEach, describe, it, vi } from "vitest";
import {
  mockPubSub,
  mockTextGenerationUtilities,
  setupCommonTextGenerationMocks,
  testTextGenerationBehavior,
} from "./testUtils";

setupCommonTextGenerationMocks();
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
