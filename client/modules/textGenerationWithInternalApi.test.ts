import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "./logEntries";
import { getQuery, updateResponse, updateTextGenerationState } from "./pubSub";
import {
  ChatGenerationError,
  canStartResponding,
} from "./textGenerationUtilities";
import type { ChatMessage } from "./types";

vi.mock("./pubSub", () => ({
  getQuery: vi.fn().mockReturnValue("test query"),
  updateResponse: vi.fn(),
  updateTextGenerationState: vi.fn(),
}));

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));

vi.mock("./searchTokenHash", () => ({
  getSearchTokenHash: vi.fn().mockResolvedValue("mock-token"),
}));

vi.mock("./systemPrompt", () => ({
  getSystemPrompt: vi.fn().mockReturnValue("system prompt"),
}));

vi.mock("./textGenerationUtilities", async (importOriginal) =>
  (await import("./textGenerationTestUtils")).textGenerationUtilitiesMock({
    getDefaultChatCompletionCreateParamsStreaming: vi.fn().mockReturnValue({
      max_tokens: 1000,
      temperature: 0.35,
    }),
  })(importOriginal),
);

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function sseChunks(lines: string[]) {
  return [...lines.map((line) => `data: ${line}\n`), "data: [DONE]\n"];
}

function streamResponse(chunks: Array<string | Uint8Array>, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });
  return new Response(body, { status });
}

/**
 * A response whose stream sends `chunks`, with a spy on the stream's cancel.
 * `close` ends the stream, as a completed upstream does; leaving it open
 * stands in for a stalled one.
 */
function streamBody(chunks: string[], close: boolean) {
  const cancel = vi.fn();
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
    cancel,
  });
  return { response: new Response(body), cancel };
}

function openStreamResponse(chunks: string[]) {
  return streamBody(chunks, false);
}

/** A closed stream, with a spy on its cancel. */
function closedStreamResponse(chunks: string[]) {
  return streamBody(chunks, true);
}

/** Makes the first publish abort the generation, and returns its controller. */
function abortOnFirstPublish() {
  const controller = new AbortController();
  vi.mocked(updateResponse).mockImplementationOnce(() => controller.abort());
  return controller;
}

function fetchSignal(): AbortSignal {
  return mockFetch.mock.calls[0][1].signal;
}

async function generateChatFromChunks(chunks: Array<string | Uint8Array>) {
  const { generateChatWithInternalApi } = await import(
    "./textGenerationWithInternalApi"
  );
  mockFetch.mockResolvedValueOnce(streamResponse(chunks));

  const onUpdate = vi.fn();
  const result = await generateChatWithInternalApi(
    [{ role: "user", content: "Hi" }],
    onUpdate,
  );

  return { onUpdate, result };
}

describe("textGenerationWithInternalApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getQuery).mockReturnValue("test query");
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

      await expect(generateTextWithInternalApi()).resolves.toBe("Hello");

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

    it("logs an answer the model cut short at its token limit", async () => {
      const { generateTextWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );

      mockFetch.mockResolvedValueOnce(
        streamResponse(
          sseChunks([
            '{"choices":[{"delta":{"content":"Cut"},"finish_reason":null}]}',
            '{"choices":[{"delta":{},"finish_reason":"length"}]}',
          ]),
        ),
      );

      await expect(generateTextWithInternalApi()).resolves.toBe("Cut");
      expect(addLogEntry).toHaveBeenCalledWith(
        "The answer was cut short: the model reached its output token limit",
      );
    });

    it("logs nothing about the limit when the answer finished on its own", async () => {
      const { generateTextWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );

      mockFetch.mockResolvedValueOnce(
        streamResponse(
          sseChunks([
            '{"choices":[{"delta":{"content":"Done"},"finish_reason":null}]}',
            '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
          ]),
        ),
      );

      await expect(generateTextWithInternalApi()).resolves.toBe("Done");
      expect(addLogEntry).not.toHaveBeenCalledWith(
        expect.stringContaining("cut short"),
      );
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
          sseChunks([
            '{"choices":[{"delta":{"content":"partial"}}]}',
            '{"choices":[{"delta":{"content":" answer"}}]}',
          ]),
        ),
      );
      const controller = abortOnFirstPublish();

      await expect(
        generateTextWithInternalApi(controller.signal),
      ).rejects.toThrow("Generation interrupted");
      expect(updateResponse).toHaveBeenCalledTimes(1);
    });
  });

  describe("generateChatWithInternalApi", () => {
    it("streams incremental accumulated text as multiple SSE chunks arrive", async () => {
      const { onUpdate, result } = await generateChatFromChunks([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n',
        "data: [DONE]\n",
      ]);

      expect(result).toBe("Hello world");
      expect(onUpdate).toHaveBeenNthCalledWith(1, "Hello");
      expect(onUpdate).toHaveBeenNthCalledWith(2, "Hello world");
    });

    it("reassembles SSE frames split across arbitrary byte boundaries", async () => {
      const encodedResponse = new TextEncoder().encode(
        [
          'data: {"choices":[{"delta":{"content":"Hello 🌍"}}]}',
          'data: {"choices":[{"delta":{"content":"!"}}]}',
        ].join("\n"),
      );

      const { onUpdate, result } = await generateChatFromChunks(
        Array.from({ length: encodedResponse.length }, (_, index) =>
          encodedResponse.slice(index, index + 1),
        ),
      );

      expect(result).toBe("Hello 🌍!");
      expect(onUpdate).toHaveBeenNthCalledWith(1, "Hello 🌍");
      expect(onUpdate).toHaveBeenNthCalledWith(2, "Hello 🌍!");
    });

    it("skips a malformed data line and continues streaming", async () => {
      const { onUpdate, result } = await generateChatFromChunks([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        "data: not-json\n",
        'data: {"choices":[{"delta":{"content":" world"}}]}\n',
        "data: [DONE]\n",
      ]);

      expect(result).toBe("Hello world");
      expect(onUpdate).toHaveBeenNthCalledWith(1, "Hello");
      expect(onUpdate).toHaveBeenNthCalledWith(2, "Hello world");
    });

    it("skips [DONE], choice-less, and empty-delta lines", async () => {
      const { generateChatWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );

      mockFetch.mockResolvedValueOnce(
        streamResponse(
          sseChunks([
            '{"model":"test-model"}',
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

    it("throws ChatGenerationError after streaming partial content when error frame arrives", async () => {
      const { generateChatWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );
      const errorMessage =
        "Service unavailable - all models failed: connection timeout";

      mockFetch.mockResolvedValueOnce(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"Partial"}}]}\n',
          `data: ${JSON.stringify({ error: errorMessage })}\n\n`,
          "data: [DONE]\n\n",
        ]),
      );

      const onUpdate = vi.fn();
      const response = generateChatWithInternalApi(
        [{ role: "user", content: "Hi" }],
        onUpdate,
      );

      await expect(response).rejects.toBeInstanceOf(ChatGenerationError);
      await expect(response).rejects.toThrow(errorMessage);
      expect(onUpdate).toHaveBeenCalledWith("Partial");
    });
  });

  describe("cancelling the stream", () => {
    it("cancels the request when generation is interrupted mid-stream", async () => {
      const { generateTextWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );
      const stream = openStreamResponse([
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n',
      ]);
      mockFetch.mockResolvedValueOnce(stream.response);
      const controller = abortOnFirstPublish();

      await expect(
        generateTextWithInternalApi(controller.signal),
      ).rejects.toThrow("Generation interrupted");

      expect(fetchSignal().aborted).toBe(true);
      expect(stream.cancel).toHaveBeenCalled();
    });

    it("cancels the request when the stream sends an error frame", async () => {
      const { generateChatWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );
      const stream = openStreamResponse(['data: {"error":"boom"}\n']);
      mockFetch.mockResolvedValueOnce(stream.response);

      const error = await generateChatWithInternalApi(
        [{ role: "user", content: "Hi" }],
        vi.fn(),
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ChatGenerationError);
      expect((error as Error).message).toBe("boom");
      expect(fetchSignal().aborted).toBe(true);
      expect(stream.cancel).toHaveBeenCalled();
    });

    it("stops a silent stream as soon as generation is interrupted", async () => {
      const { generateChatWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );
      const stream = openStreamResponse([]);
      mockFetch.mockResolvedValueOnce(stream.response);

      const controller = new AbortController();
      const chat = generateChatWithInternalApi(
        [{ role: "user", content: "Hi" }],
        vi.fn(),
        controller.signal,
      );
      const outcome = expect(chat).rejects.toThrow(
        "Chat generation interrupted",
      );
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
      // No chunk ever arrives, so only the signal can end the wait.
      controller.abort();
      await outcome;

      expect(fetchSignal().aborted).toBe(true);
      expect(stream.cancel).toHaveBeenCalled();
    });

    it("leaves a finished request alone and stops listening", async () => {
      const { generateChatWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );
      const stream = closedStreamResponse(
        sseChunks(['{"choices":[{"delta":{"content":"Hello"}}]}']),
      );
      mockFetch.mockResolvedValueOnce(stream.response);
      const controller = new AbortController();

      await expect(
        generateChatWithInternalApi(
          [{ role: "user", content: "Hi" }],
          vi.fn(),
          controller.signal,
        ),
      ).resolves.toBe("Hello");

      // Aborting the caller's signal afterwards reaches nothing.
      controller.abort();
      expect(fetchSignal().aborted).toBe(false);
      expect(stream.cancel).not.toHaveBeenCalled();
    });
  });
});
