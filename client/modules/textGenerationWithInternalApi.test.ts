import { beforeEach, describe, it, vi } from "vitest";
import {
  mockPubSub,
  mockTextGenerationUtilities,
  testTextGenerationBehavior,
} from "./testUtils";

vi.stubGlobal("fetch", vi.fn());

vi.mock("./pubSub", () => mockPubSub());
vi.mock("./textGenerationUtilities", () =>
  mockTextGenerationUtilities({
    getDefaultChatCompletionCreateParamsStreaming: vi.fn(),
  }),
);
vi.mock("./searchTokenHash", () => ({
  getSearchTokenHash: vi.fn().mockResolvedValue("token"),
}));
vi.mock("./systemPrompt", () => ({
  getSystemPrompt: vi.fn(() => "system"),
}));

import * as mod from "./textGenerationWithInternalApi";

describe("generateTextWithInternalApi", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // biome-ignore lint/suspicious/noExplicitAny: Necessary for test mocking
    (mod as any).processStreamResponse = vi
      .fn()
      .mockResolvedValue("streamed message");

    const mockResponse = {
      ok: true,
      body: {
        getReader: vi.fn().mockReturnValue({
          read: vi.fn().mockResolvedValue({ done: true }),
        }),
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: Necessary for test mocking
    (global.fetch as any) = vi.fn().mockResolvedValue(mockResponse);
  });

  it("calls helpers and updates state", async () => {
    await testTextGenerationBehavior(
      () => mod.generateTextWithInternalApi(),
      "",
    );
  });
});
