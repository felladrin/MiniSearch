import { beforeEach, describe, it, vi } from "vitest";
import {
  mockPubSub,
  mockTextGenerationUtilities,
  testTextGenerationBehavior,
} from "./testUtils";

vi.mock("@root/package.json", () => ({
  repository: { url: "https://github.com/owner/repo" },
  version: "1.0.0",
}));
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
      temperature: 0.7,
      top_p: 1.0,
      min_p: 0.0,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
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
        const pubSub = await import("./pubSub");
        const utils = await import("./textGenerationUtilities");

        await utils.canStartResponding();
        pubSub.updateTextGenerationState("preparingToGenerate");
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
