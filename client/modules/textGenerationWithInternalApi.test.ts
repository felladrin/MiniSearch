import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getQuery,
  getTextGenerationState,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import { canStartResponding } from "./textGenerationUtilities";
import type { ChatMessage } from "./types";

vi.mock("./pubSub", () => ({
  getQuery: vi.fn().mockReturnValue("test query"),
  getTextGenerationState: vi.fn().mockReturnValue("idle"),
  updateResponse: vi.fn(),
  updateTextGenerationState: vi.fn(),
}));

vi.mock("./searchTokenHash", () => ({
  getSearchTokenHash: vi.fn().mockResolvedValue("mock-token"),
}));

vi.mock("./systemPrompt", () => ({
  getSystemPrompt: vi.fn().mockReturnValue("system prompt"),
}));

// canStartResponding/getFormattedSearchResults depend on pubSub state we
// don't want to drive here; ChatGenerationError has no such dependency, so
// keep it real so `instanceof` checks against it still work.
vi.mock("./textGenerationUtilities", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./textGenerationUtilities")>();
  return {
    ...actual,
    canStartResponding: vi.fn().mockResolvedValue(undefined),
    getFormattedSearchResults: vi.fn().mockReturnValue("None."),
    getDefaultChatCompletionCreateParamsStreaming: vi.fn().mockReturnValue({
      max_tokens: 1000,
      temperature: 0.35,
    }),
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function sseChunks(lines: string[]) {
  return [...lines.map((line) => `data: ${line}\n`), "data: [DONE]\n"];
}

function streamResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status });
}

describe("textGenerationWithInternalApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getQuery).mockReturnValue("test query");
    vi.mocked(getTextGenerationState).mockReturnValue("idle");
  });

  describe("generateTextWithInternalApi", () => {
    it("builds the chat messages, streams the response, and updates state", async () => {
      const { generateTextWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );

      mockFetch.mockResolvedValueOnce(
        streamResponse(
          sseChunks(['{"choices":[{"delta":{"content":"Hello"}}]}']),
        ),
      );

      await generateTextWithInternalApi();

      expect(canStartResponding).toHaveBeenCalled();
      expect(updateTextGenerationState).toHaveBeenCalledWith(
        "preparingToGenerate",
      );
      expect(updateTextGenerationState).toHaveBeenCalledWith("generating");
      expect(updateResponse).toHaveBeenLastCalledWith("Hello");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/inference");
      expect(url).toContain("token=mock-token");
      const requestMessages = JSON.parse(init.body).messages as ChatMessage[];
      expect(requestMessages).toEqual([
        { role: "user", content: "system prompt" },
        { role: "assistant", content: "Ok!" },
        { role: "user", content: "test query" },
      ]);
    });

    it("throws an HTTP error on a non-OK response", async () => {
      const { generateTextWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );

      mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));

      await expect(generateTextWithInternalApi()).rejects.toThrow(
        "HTTP error! status: 500",
      );
    });

    it("throws an HTTP error when the response has no body", async () => {
      const { generateTextWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );

      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

      await expect(generateTextWithInternalApi()).rejects.toThrow(
        "HTTP error! status: 200",
      );
    });

    it("throws once generation is interrupted mid-stream", async () => {
      const { generateTextWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );

      mockFetch.mockResolvedValueOnce(
        streamResponse(
          sseChunks(['{"choices":[{"delta":{"content":"partial"}}]}']),
        ),
      );
      vi.mocked(getTextGenerationState).mockReturnValue("interrupted");

      await expect(generateTextWithInternalApi()).rejects.toThrow(
        "Generation interrupted",
      );
    });
  });

  describe("generateChatWithInternalApi", () => {
    it("streams incremental accumulated text as multiple SSE chunks arrive", async () => {
      const { generateChatWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );

      mockFetch.mockResolvedValueOnce(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
          'data: {"choices":[{"delta":{"content":" world"}}]}\n',
          "data: [DONE]\n",
        ]),
      );

      const onUpdate = vi.fn();
      const result = await generateChatWithInternalApi(
        [{ role: "user", content: "Hi" }],
        onUpdate,
      );

      expect(result).toBe("Hello world");
      expect(onUpdate).toHaveBeenNthCalledWith(1, "Hello");
      expect(onUpdate).toHaveBeenNthCalledWith(2, "Hello world");
    });

    it("skips [DONE] and empty-delta lines instead of treating them as content", async () => {
      const { generateChatWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );

      mockFetch.mockResolvedValueOnce(
        streamResponse(
          sseChunks([
            '{"choices":[{"delta":{}}]}',
            '{"choices":[{"delta":{"content":"Hello"}}]}',
          ]),
        ),
      );

      const onUpdate = vi.fn();
      await generateChatWithInternalApi(
        [{ role: "user", content: "Hi" }],
        onUpdate,
      );

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith("Hello");
    });
  });
});
