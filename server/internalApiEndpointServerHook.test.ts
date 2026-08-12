import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./handleTokenVerification", () => ({
  handleTokenVerification: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: vi.fn(),
}));

vi.mock("@ai-sdk/openai-compatible", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ai-sdk/openai-compatible")>()),
  createOpenAICompatible: vi.fn(),
}));

vi.mock("./config/modelConfig", () => ({
  getModelConfig: vi.fn(),
}));

vi.mock("../shared/openaiModels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/openaiModels")>()),
  listOpenAiCompatibleModels: vi.fn(),
  selectRandomModel: vi.fn(),
}));

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "../shared/openaiModels";
import { getModelConfig } from "./config/modelConfig";
import { handleTokenVerification } from "./handleTokenVerification";
import { internalApiEndpointServerHook } from "./internalApiEndpointServerHook";

function createRequest(
  body: unknown,
  method = "POST",
  contentType = "application/json",
): IncomingMessage {
  const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  request.url = "/inference?token=abc";
  request.method = method;
  request.headers = {
    host: "localhost:3000",
    "content-type": contentType,
  };
  return request;
}

function createResponse(): ServerResponse & {
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  const headersSent = {
    value: false,
  };
  return {
    statusCode: 200,
    get headersSent() {
      return headersSent.value;
    },
    set headersSent(v: boolean) {
      headersSent.value = v;
    },
    writableEnded: false,
    destroyed: false,
    setHeader: vi.fn(),
    end: vi.fn(() => {
      headersSent.value = true;
    }),
    write: vi.fn().mockImplementation(() => {
      headersSent.value = true;
      return true;
    }),
    destroy: vi.fn(),
  } as unknown as ServerResponse & {
    setHeader: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
}

function getRegisteredHandler() {
  const use = vi.fn();
  internalApiEndpointServerHook({
    middlewares: { use },
  } as unknown as Parameters<typeof internalApiEndpointServerHook>[0]);
  return use.mock.calls[0][0] as (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => Promise<void>;
}

function streamOf(
  pieces: Array<{ type: string; text?: string; error?: unknown }>,
) {
  return {
    fullStream: (async function* () {
      for (const piece of pieces) yield piece as never;
    })(),
  };
}

describe("internalApiEndpointServerHook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("HTTP guards", () => {
    it("responds 405 when method is not POST", async () => {
      const handler = getRegisteredHandler();
      const response = createResponse();
      const request = createRequest({}, "GET");
      await handler(request, response, vi.fn());
      expect(response.statusCode).toBe(405);
      expect(response.setHeader).toHaveBeenCalledWith("Allow", "POST");
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload.error).toBe("Method Not Allowed");
    });

    it("responds 415 when Content-Type is not application/json", async () => {
      const handler = getRegisteredHandler();
      const response = createResponse();
      const request = createRequest({}, "POST", "text/plain");
      await handler(request, response, vi.fn());
      expect(response.statusCode).toBe(415);
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload.error).toBe("Unsupported Media Type");
    });

    it("accepts Content-Type application/json with charset", async () => {
      vi.mocked(handleTokenVerification).mockResolvedValue({
        shouldContinue: false,
      });
      const handler = getRegisteredHandler();
      const response = createResponse();
      const request = createRequest(
        {},
        "POST",
        "application/json; charset=utf-8",
      );
      await handler(request, response, vi.fn());
      expect(handleTokenVerification).toHaveBeenCalled();
    });

    it("passes through when URL does not start with /inference", async () => {
      const handler = getRegisteredHandler();
      const next = vi.fn();
      const response = createResponse();
      const request = createRequest({});
      request.url = "/other?token=abc";
      await handler(request, response, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(response.end).not.toHaveBeenCalled();
    });

    it("responds 400 when request.url is missing", async () => {
      const handler = getRegisteredHandler();
      const response = createResponse();
      const request = createRequest({});
      request.url = undefined;
      await handler(request, response, vi.fn());
      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload.error).toContain("URL is required");
    });
  });

  describe("body validation", () => {
    it.each([
      { name: "messages is missing", body: {}, expectedPath: "messages" },
      {
        name: "messages is empty",
        body: { messages: [] },
        expectedPath: "messages",
      },
      {
        name: "a message role is invalid",
        body: { messages: [{ role: "admin", content: "hello" }] },
        expectedPath: "messages.0.role",
      },
      {
        name: "message content is not a string",
        body: { messages: [{ role: "user", content: 42 }] },
        expectedPath: "messages.0.content",
      },
    ])("responds 400 when $name", async ({ body, expectedPath }) => {
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(createRequest(body), response, vi.fn());
      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload.error).toContain(`Invalid request body: ${expectedPath}`);
    });

    it("responds 413 when accumulated chunks exceed 1MB", async () => {
      const handler = getRegisteredHandler();
      const response = createResponse();
      const chunk600k = "x".repeat(600 * 1024);
      const request = Readable.from([chunk600k, chunk600k]) as IncomingMessage;
      request.url = "/inference?token=abc";
      request.method = "POST";
      request.headers = {
        host: "localhost:3000",
        "content-type": "application/json",
      };
      await handler(request, response, vi.fn());
      expect(response.statusCode).toBe(413);
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload.error).toBe("Request body too large");
    });

    it("responds 400 when body is not valid JSON", async () => {
      const handler = getRegisteredHandler();
      const response = createResponse();
      const request = Readable.from(["not json at all"]) as IncomingMessage;
      request.url = "/inference?token=abc";
      request.method = "POST";
      request.headers = {
        host: "localhost:3000",
        "content-type": "application/json",
      };
      await handler(request, response, vi.fn());
      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload.error).toBe("Invalid request body");
    });
  });

  describe("environment configuration", () => {
    it("responds 500 when API configuration is missing", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL", undefined);
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_KEY", undefined);
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      expect(response.statusCode).toBe(500);
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload.error).toBe("OpenAI API configuration is missing");
    });
  });

  describe("token verification", () => {
    it("stops processing when token verification fails", async () => {
      vi.mocked(handleTokenVerification).mockResolvedValue({
        shouldContinue: false,
      });
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      expect(handleTokenVerification).toHaveBeenCalledWith(
        "abc",
        expect.anything(),
        expect.anything(),
      );
      expect(response.end).not.toHaveBeenCalled();
    });
  });

  describe("streaming path", () => {
    const setupStreaming = () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL", "http://test-api");
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_KEY", "test-key");
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", "test-model");
      vi.mocked(getModelConfig).mockReturnValue({
        maxRetries: 5,
        baseBackoffMs: 100,
        maxBackoffMs: 5000,
        requestTimeoutMs: 30000,
        maxConcurrentRequests: 10,
        defaultMaxTokens: 2048,
        temperature: 0.7,
        topP: 0.9,
      });
      vi.mocked(createOpenAICompatible).mockReturnValue({
        chatModel: vi.fn().mockReturnValue("mock-chat-model"),
      } as never);
    };

    beforeEach(setupStreaming);

    it("emits SSE frames on successful stream", async () => {
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "text-delta", text: "Hello" },
            { type: "finish" },
          ]) as never,
      );
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      const writeCalls = response.write.mock.calls.map((c) => c[0]);
      expect(
        writeCalls.some((s: string) => s.includes('"content":"Hello"')),
      ).toBe(true);
      expect(
        writeCalls.some((s: string) => s.includes('"finish_reason":"stop"')),
      ).toBe(true);
      expect(writeCalls.some((s: string) => s.includes("[DONE]"))).toBe(true);
    });

    it("clamps max_tokens to defaultMaxTokens", async () => {
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "text-delta", text: "Ok" },
            { type: "finish" },
          ]) as never,
      );
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 9999,
        }),
        response,
        vi.fn(),
      );
      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.maxOutputTokens).toBe(2048);
    });

    it("passes max_tokens unchanged when under cap", async () => {
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "text-delta", text: "Ok" },
            { type: "finish" },
          ]) as never,
      );
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 100,
        }),
        response,
        vi.fn(),
      );
      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.maxOutputTokens).toBe(100);
    });

    it("passes undefined maxOutputTokens when max_tokens not provided", async () => {
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "text-delta", text: "Ok" },
            { type: "finish" },
          ]) as never,
      );
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.maxOutputTokens).toBeUndefined();
    });

    it.each([
      {
        param: "temperature",
        reqKey: "temperature" as const,
        argKey: "temperature" as const,
      },
      {
        param: "top_p",
        reqKey: "top_p" as const,
        argKey: "topP" as const,
      },
      {
        param: "max_tokens",
        reqKey: "max_tokens" as const,
        argKey: "maxOutputTokens" as const,
      },
    ])(
      "passes $param: 0 through instead of dropping it",
      async ({ reqKey, argKey }) => {
        vi.mocked(streamText).mockImplementation(
          () => streamOf([{ type: "finish" }]) as never,
        );
        const handler = getRegisteredHandler();
        const response = createResponse();
        await handler(
          createRequest({
            messages: [{ role: "user", content: "hi" }],
            [reqKey]: 0,
          }),
          response,
          vi.fn(),
        );
        const callArgs = vi.mocked(streamText).mock.calls[0][0];
        expect(callArgs[argKey]).toBe(0);
      },
    );

    it.each([
      {
        param: "temperature",
        reqKey: "temperature" as const,
        reqValue: 5,
        clampedTo: 2,
        argKey: "temperature" as const,
      },
      {
        param: "top_p",
        reqKey: "top_p" as const,
        reqValue: 3,
        clampedTo: 1,
        argKey: "topP" as const,
      },
    ])(
      "clamps $param to its upper bound (reqValue=$reqValue → clampedTo=$clampedTo)",
      async ({ reqKey, reqValue, clampedTo, argKey }) => {
        vi.mocked(streamText).mockImplementation(
          () => streamOf([{ type: "finish" }]) as never,
        );
        const handler = getRegisteredHandler();
        const response = createResponse();
        await handler(
          createRequest({
            messages: [{ role: "user", content: "hi" }],
            [reqKey]: reqValue,
          }),
          response,
          vi.fn(),
        );
        const callArgs = vi.mocked(streamText).mock.calls[0][0];
        expect(callArgs[argKey]).toBe(clampedTo);
      },
    );

    it("emits error SSE when stream ends without finish", async () => {
      vi.mocked(streamText).mockImplementation(
        () => streamOf([{ type: "text-delta", text: "Partial" }]) as never,
      );
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      const writeCalls = response.write.mock.calls.map((c) => c[0]);
      expect(
        writeCalls.some((s: string) => s.includes("Stream ended unexpectedly")),
      ).toBe(true);
    });

    it("responds 503 JSON when the stream ends before any content", async () => {
      vi.mocked(streamText).mockImplementation(() => streamOf([]) as never);
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      expect(response.statusCode).toBe(503);
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload.lastError).toBe("Stream ended unexpectedly");
      expect(response.write).not.toHaveBeenCalled();
    });

    it("retries with another model when the stream ends before any content", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
      vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([
        { id: "model-a" },
        { id: "model-b" },
      ]);
      vi.mocked(selectRandomModel)
        .mockReturnValueOnce("model-a")
        .mockReturnValueOnce("model-b");

      let callCount = 0;
      vi.mocked(streamText).mockImplementation(() => {
        callCount += 1;
        return (
          callCount === 1
            ? streamOf([])
            : streamOf([
                { type: "text-delta", text: "Recovered" },
                { type: "finish" },
              ])
        ) as never;
      });

      vi.useFakeTimers();
      try {
        const handler = getRegisteredHandler();
        const response = createResponse();
        const pending = handler(
          createRequest({ messages: [{ role: "user", content: "hi" }] }),
          response,
          vi.fn(),
        );
        await vi.runAllTimersAsync();
        await pending;

        expect(streamText).toHaveBeenCalledTimes(2);
        const writes = response.write.mock.calls.map((c) => c[0]).join("");
        expect(writes).toContain("Recovered");
        expect(writes).not.toContain("Stream ended unexpectedly");
      } finally {
        vi.useRealTimers();
      }
    });

    it("returns early when response is no longer writable", async () => {
      vi.mocked(streamText).mockImplementation(
        () => streamOf([{ type: "text-delta", text: "Hello" }]) as never,
      );
      const handler = getRegisteredHandler();
      const response = createResponse();
      const mutable = response as {
        writableEnded: boolean;
        destroyed: boolean;
      };
      mutable.writableEnded = true;
      mutable.destroyed = true;
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      expect(response.setHeader).not.toHaveBeenCalled();
      expect(streamText).not.toHaveBeenCalled();
    });

    it("surfaces an error part instead of reporting unexpected stream end", async () => {
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "text-delta", text: "Partial" },
            { type: "error", error: new Error("upstream exploded") },
          ]) as never,
      );
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      const writes = response.write.mock.calls.map((c) => c[0]).join("");
      expect(writes).toContain("all models failed: upstream exploded");
      expect(writes).not.toContain("Stream ended unexpectedly");
    });

    it("retries with another model when the stream errors before any content", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
      vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([
        { id: "model-a" },
        { id: "model-b" },
      ]);
      vi.mocked(selectRandomModel)
        .mockReturnValueOnce("model-a")
        .mockReturnValueOnce("model-b");

      let callCount = 0;
      vi.mocked(streamText).mockImplementation(() => {
        callCount += 1;
        return (
          callCount === 1
            ? streamOf([
                { type: "error", error: new Error("upstream exploded") },
              ])
            : streamOf([
                { type: "text-delta", text: "Recovered" },
                { type: "finish" },
              ])
        ) as never;
      });

      vi.useFakeTimers();
      try {
        const handler = getRegisteredHandler();
        const response = createResponse();
        const pending = handler(
          createRequest({ messages: [{ role: "user", content: "hi" }] }),
          response,
          vi.fn(),
        );
        await vi.runAllTimersAsync();
        await pending;

        expect(streamText).toHaveBeenCalledTimes(2);
        const writes = response.write.mock.calls.map((c) => c[0]).join("");
        expect(writes).toContain("Recovered");
        expect(writes).not.toContain("all models failed");
      } finally {
        vi.useRealTimers();
      }
    });

    it("responds 503 JSON when the only model's stream fails before any content", async () => {
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "error", error: new Error("upstream down") },
          ]) as never,
      );
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      expect(response.statusCode).toBe(503);
      expect(response.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/json",
      );
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload).toEqual({
        error: "Service unavailable - all models failed",
        lastError: "upstream down",
      });
      expect(response.setHeader).not.toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(response.write).not.toHaveBeenCalled();
      expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    });

    it("responds 503 JSON when the only model cannot start", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        throw new Error("upstream down");
      });
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      expect(response.statusCode).toBe(503);
      expect(response.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/json",
      );
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload).toEqual({
        error: "Service unavailable - all models failed",
        lastError: "upstream down",
      });
      expect(response.write).not.toHaveBeenCalled();
      expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    });

    it("retries on model failure and succeeds on second attempt", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);

      vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([
        { id: "model-a" },
        { id: "model-b" },
      ]);
      vi.mocked(selectRandomModel)
        .mockReturnValueOnce("model-a")
        .mockReturnValueOnce("model-b");

      let callCount = 0;
      vi.mocked(streamText).mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("upstream down");
        }
        return streamOf([
          { type: "text-delta", text: "Ok" },
          { type: "finish" },
        ]) as never;
      });

      vi.useFakeTimers();
      try {
        const handler = getRegisteredHandler();
        const response = createResponse();
        const pending = handler(
          createRequest({ messages: [{ role: "user", content: "hi" }] }),
          response,
          vi.fn(),
        );
        await vi.runAllTimersAsync();
        await pending;

        expect(streamText).toHaveBeenCalledTimes(2);
        const secondCallArgs = vi.mocked(selectRandomModel).mock.calls[1][1];
        expect(secondCallArgs).toBeInstanceOf(Set);
        expect((secondCallArgs as Set<string>).has("model-a")).toBe(true);
        const writeCalls = response.write.mock.calls.map((c) => c[0]);
        expect(writeCalls.some((s: string) => s.includes("[DONE]"))).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not retry after content was already sent to the client", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
      vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([
        { id: "model-a" },
        { id: "model-b" },
      ]);
      vi.mocked(selectRandomModel)
        .mockReturnValueOnce("model-a")
        .mockReturnValueOnce("model-b");

      let callCount = 0;
      vi.mocked(streamText).mockImplementation(() => {
        callCount += 1;
        return (
          callCount === 1
            ? streamOf([
                { type: "text-delta", text: "Half an answer" },
                { type: "error", error: new Error("upstream exploded") },
              ])
            : streamOf([
                { type: "text-delta", text: "A different answer" },
                { type: "finish" },
              ])
        ) as never;
      });

      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );

      expect(streamText).toHaveBeenCalledTimes(1);
      const writes = response.write.mock.calls.map((c) => c[0]).join("");
      expect(writes).not.toContain("A different answer");
      expect(writes).toContain("all models failed");
      expect(writes).toContain("[DONE]");
    });

    it("responds 500 when model list fetch fails and no env model set", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
      vi.mocked(listOpenAiCompatibleModels).mockRejectedValue(
        new Error("network error"),
      );
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      expect(response.statusCode).toBe(500);
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload.error).toBe("Failed to fetch available models");
    });

    it("responds 500 when model list is empty and no env model set", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
      vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([]);
      vi.mocked(selectRandomModel).mockReturnValue(null);
      const handler = getRegisteredHandler();
      const response = createResponse();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      expect(response.statusCode).toBe(500);
      const payload = JSON.parse(response.end.mock.calls[0][0]);
      expect(payload.error).toBe("No model available");
    });
  });
});
