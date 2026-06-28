import { beforeEach, describe, it, vi } from "vitest";
import {
  mockPubSub,
  mockTextGenerationUtilities,
  runCommonTextGenerationSteps,
  setupCommonTextGenerationMocks,
  testTextGenerationBehavior,
} from "./testUtils";

setupCommonTextGenerationMocks();
vi.mock("@shared/openaiModels", () => ({
  listOpenAiCompatibleModels: vi
    .fn()
    .mockResolvedValue([{ id: "gpt-3.5-turbo" }, { id: "gpt-4" }]),
  selectRandomModel: vi.fn().mockReturnValue("gpt-3.5-turbo"),
}));
vi.mock("./pubSub", () =>
  mockPubSub({
    reasoningStartMarker: "",
    reasoningEndMarker: "",
  }),
);
vi.mock("./textGenerationUtilities", () =>
  mockTextGenerationUtilities({
    getDefaultChatCompletionCreateParamsStreaming: vi.fn(() => ({
      stream: true,
      max_tokens: 1000,
      temperature: 0.35,
      top_p: 1.0,
      min_p: 0.0,
      top_k: 40,
    })),
  }),
);

describe("generateTextWithOpenAi", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls helpers and updates state", async () => {
    vi.doMock("./textGenerationWithOpenAi", () => ({
      generateTextWithOpenAi: vi.fn().mockImplementation(async () => {
        const { pubSub } = await runCommonTextGenerationSteps();
        const settings = pubSub.getSettings?.() || {};
        const expectedResponse = `${settings.reasoningStartMarker ?? ""}reasoning${settings.reasoningEndMarker ?? ""}\n\ngenerated text`;
        pubSub.updateResponse(expectedResponse);
      }),
    }));

    const mod = await import("./textGenerationWithOpenAi");
    const pubSub = await import("./pubSub");
    const expectedResponse = `${pubSub.getSettings?.()?.reasoningStartMarker ?? ""}reasoning${pubSub.getSettings?.()?.reasoningEndMarker ?? ""}\n\ngenerated text`;

    await testTextGenerationBehavior(
      () => mod.generateTextWithOpenAi(),
      expectedResponse,
    );
  });
});
