import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

vi.mock("../shared/openaiModels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/openaiModels")>()),
  listOpenAiCompatibleModels: vi.fn(),
  selectRandomModel: vi.fn(),
}));

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, streamText } from "ai";
import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "../shared/openaiModels";
import { handleTokenVerification } from "./handleTokenVerification";
import { getInferenceStats } from "./inferencesSinceLastRestart";
import { internalApiEndpointServerHook } from "./internalApiEndpointServerHook";

function createRequest(
  body: unknown,
  method = "POST",
  contentType = "application/json",
): IncomingMessage {
  return createRawRequest([JSON.stringify(body)], method, contentType);
}

/** A request whose body arrives as these chunks, sent as they are. */
function createRawRequest(
  chunks: string[],
  method = "POST",
  contentType = "application/json",
): IncomingMessage {
  const request = Readable.from(chunks) as IncomingMessage;
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
  pieces: Array<{
    type: string;
    text?: string;
    error?: unknown;
    finishReason?: string;
  }>,
) {
  return {
    stream: (async function* () {
      // The SDK always gives a finish part its reason.
      for (const piece of pieces)
        yield (
          piece.type === "finish" ? { finishReason: "stop", ...piece } : piece
        ) as never;
    })(),
  };
}

const helloBody = { messages: [{ role: "user", content: "hi" }] };

/** Sends a request to the hook and returns the response with its pending run. */
function startRequest(body: unknown = helloBody) {
  const response = createResponse();
  const pending = getRegisteredHandler()(
    createRequest(body),
    response,
    vi.fn(),
  );
  return { response, pending };
}

async function sendRequest(body: unknown = helloBody) {
  const { response, pending } = startRequest(body);
  await pending;
  return response;
}

function endPayload(response: ReturnType<typeof createResponse>) {
  return JSON.parse(response.end.mock.calls[0][0]);
}

function writtenFrames(response: ReturnType<typeof createResponse>) {
  return response.write.mock.calls.map((c) => c[0] as string);
}

function writtenText(response: ReturnType<typeof createResponse>) {
  return response.write.mock.calls.map((c) => c[0]).join("");
}

/** A stream that answers `text` in one piece, then finishes. */
function answerStream(text: string) {
  return streamOf([{ type: "text-delta", text }, { type: "finish" }]);
}

/** Runs the request with fake timers until it settles, so retries and stalls play out. */
async function sendRequestThroughTimers(body: unknown = helloBody) {
  vi.useFakeTimers();
  try {
    const { response, pending } = startRequest(body);
    await vi.runAllTimersAsync();
    await pending;
    return response;
  } finally {
    vi.useRealTimers();
  }
}

/**
 * A stream that yields `before`, then waits for the request's abort and yields
 * an abort part, as the AI SDK's pull handler does.
 */
function stallUntilAborted(
  abortSignal: AbortSignal | undefined,
  before: Array<{ type: string; text?: string }> = [],
) {
  return {
    stream: (async function* () {
      for (const piece of before) yield piece as never;
      await new Promise<void>((resolve) => {
        if (abortSignal?.aborted) resolve();
        else
          abortSignal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
      });
      yield { type: "abort" } as never;
    })(),
  };
}

/** The first upstream call streams `first()`; every later call, `then()`. */
function streamFirstThen(
  first: () => ReturnType<typeof streamOf>,
  then: () => ReturnType<typeof streamOf>,
) {
  vi.mocked(streamText)
    .mockImplementationOnce(() => first() as never)
    .mockImplementation(() => then() as never);
}

/** The internal API is configured, and the provider hands back a chat model. */
function configureStreamingApi() {
  vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL", "http://test-api");
  vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_KEY", "test-key");
  vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", "test-model");
  vi.mocked(createOpenAICompatible).mockReturnValue({
    chatModel: vi.fn().mockReturnValue("mock-chat-model"),
  } as never);
}

/** Every upstream call streams a fresh `stream()`. */
function streamEveryCall(stream: () => ReturnType<typeof streamOf>) {
  vi.mocked(streamText).mockImplementation(() => stream() as never);
}

/** Sends a hello request with `extra` fields; returns what reached `streamText`. */
async function upstreamArgsFor(extra: Record<string, unknown>) {
  await sendRequest({ ...helloBody, ...extra });
  return vi.mocked(streamText).mock.calls[0][0];
}

/** The second attempt answers "Recovered"; returns everything written. */
async function sendExpectingSecondAttemptToRecover() {
  const response = await sendRequestThroughTimers();
  expect(streamText).toHaveBeenCalledTimes(2);
  const writes = writtenText(response);
  expect(writes).toContain("Recovered");
  return writes;
}

function expectAllModelsFailedJson(
  response: ReturnType<typeof createResponse>,
  lastError: string,
) {
  expect(response.statusCode).toBe(503);
  expect(response.setHeader).toHaveBeenCalledWith(
    "Content-Type",
    "application/json",
  );
  expect(endPayload(response)).toEqual({
    error: "Service unavailable - all models failed",
    lastError,
  });
}

/** Each listing returns one model (model-a, then model-b), so a retry re-lists. */
function useOneModelPoolsThatRelist() {
  vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
  vi.mocked(listOpenAiCompatibleModels)
    .mockResolvedValueOnce([{ id: "model-a" }])
    .mockResolvedValueOnce([{ id: "model-b" }]);
  vi.mocked(selectRandomModel)
    .mockReturnValueOnce("model-a")
    .mockReturnValueOnce("model-b");
}

function failModelListing() {
  vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
  vi.mocked(listOpenAiCompatibleModels).mockRejectedValue(
    new Error("registry timeout"),
  );
}

/** `label` was logged with the message only, and no Error object reached the log. */
function expectOnlyMessageLogged(
  errorSpy: { mock: { calls: unknown[][] } },
  label: string,
  message: string,
) {
  const call = errorSpy.mock.calls.find((logged) => logged[0] === label);
  expect(call).toBeDefined();
  expect(call?.[1]).toBe(message);
  expect(
    errorSpy.mock.calls.every((logged) => !(logged[1] instanceof Error)),
  ).toBe(true);
}

/** No configured model: each attempt picks model-a, then model-b. */
function useTwoRandomModels() {
  vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
  vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([
    { id: "model-a" },
    { id: "model-b" },
  ]);
  vi.mocked(selectRandomModel)
    .mockReturnValueOnce("model-a")
    .mockReturnValueOnce("model-b");
}

describe("internalApiEndpointServerHook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: true,
    });
    // The hook reads the real config, so a value exported in the shell that
    // runs the tests would otherwise leak into them.
    for (const variable of [
      "INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL",
      "INTERNAL_OPENAI_COMPATIBLE_API_KEY",
      "INTERNAL_OPENAI_COMPATIBLE_API_MODEL",
      "INTERNAL_OPENAI_COMPATIBLE_API_NAME",
      "INTERNAL_OPENAI_COMPATIBLE_API_CONTEXT_LENGTH",
      "INTERNAL_OPENAI_COMPATIBLE_API_REASONING_EFFORT",
      "MODEL_DEFAULT_MAX_TOKENS",
      "MODEL_REQUEST_TIMEOUT_MS",
    ]) {
      vi.stubEnv(variable, undefined);
    }
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
      const payload = endPayload(response);
      expect(payload.error).toBe("Method Not Allowed");
    });

    it("responds 415 when Content-Type is not application/json", async () => {
      const handler = getRegisteredHandler();
      const response = createResponse();
      const request = createRequest({}, "POST", "text/plain");
      await handler(request, response, vi.fn());
      expect(response.statusCode).toBe(415);
      const payload = endPayload(response);
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

    it.each([
      ["GET", "/inferences"],
      ["POST", "/inferenceX?token=abc"],
      ["POST", "/inference/extra?token=abc"],
    ])(
      "passes through %s %s, which is not the /inference route",
      async (method, url) => {
        const handler = getRegisteredHandler();
        const next = vi.fn();
        const response = createResponse();
        const request = createRequest({}, method);
        request.url = url;
        await handler(request, response, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(response.end).not.toHaveBeenCalled();
        expect(handleTokenVerification).not.toHaveBeenCalled();
      },
    );

    it("passes on a request without a URL instead of answering for it", async () => {
      const handler = getRegisteredHandler();
      const next = vi.fn();
      const response = createResponse();
      const request = createRequest({});
      request.url = undefined;
      await handler(request, response, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(response.end).not.toHaveBeenCalled();
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
      const payload = endPayload(response);
      expect(payload.error).toContain(`Invalid request body: ${expectedPath}`);
    });

    it("responds 413 when accumulated chunks exceed 1MB", async () => {
      const handler = getRegisteredHandler();
      const response = createResponse();
      const chunk600k = "x".repeat(600 * 1024);
      const request = createRawRequest([chunk600k, chunk600k]);
      await handler(request, response, vi.fn());
      expect(response.statusCode).toBe(413);
      const payload = endPayload(response);
      expect(payload.error).toBe("Request body too large");
    });

    it("responds 400 when body is not valid JSON", async () => {
      const handler = getRegisteredHandler();
      const response = createResponse();
      const request = createRawRequest(["not json at all"]);
      await handler(request, response, vi.fn());
      expect(response.statusCode).toBe(400);
      const payload = endPayload(response);
      expect(payload.error).toBe("Invalid request body");
    });
  });

  describe("environment configuration", () => {
    it("responds 500 when API configuration is missing", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL", undefined);
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_KEY", undefined);
      const response = await sendRequest();
      expect(response.statusCode).toBe(500);
      const payload = endPayload(response);
      expect(payload.error).toBe("OpenAI API configuration is missing");
    });
  });

  describe("token verification", () => {
    it("stops processing when token verification fails", async () => {
      vi.mocked(handleTokenVerification).mockResolvedValue({
        shouldContinue: false,
      });
      const response = await sendRequest();
      expect(handleTokenVerification).toHaveBeenCalledWith(
        "abc",
        expect.anything(),
        expect.anything(),
      );
      expect(response.end).not.toHaveBeenCalled();
    });
  });

  describe("streaming path", () => {
    beforeEach(configureStreamingApi);

    function requestedModels() {
      const provider = vi.mocked(createOpenAICompatible).mock.results[0]
        .value as { chatModel: ReturnType<typeof vi.fn> };
      return provider.chatModel.mock.calls.map((call) => call[0]);
    }

    it("sends the configured reasoning effort upstream", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_REASONING_EFFORT", " low ");
      streamEveryCall(() => streamOf([{ type: "finish" }]));

      await sendRequestThroughTimers();

      expect(vi.mocked(streamText).mock.calls[0][0].providerOptions).toEqual({
        openai: { reasoningEffort: "low" },
      });
    });

    it("leaves the reasoning effort to the upstream when unset", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_REASONING_EFFORT", "");
      streamEveryCall(() => streamOf([{ type: "finish" }]));

      await sendRequestThroughTimers();

      expect(
        vi.mocked(streamText).mock.calls[0][0].providerOptions,
      ).toBeUndefined();
    });

    it("tries the configured models in their order", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", " model-a , model-b ");
      vi.mocked(streamText)
        .mockImplementationOnce(() => streamOf([]) as never)
        .mockImplementationOnce(() => answerStream("Recovered") as never);

      const response = await sendRequestThroughTimers();

      expect(requestedModels()).toEqual(["model-a", "model-b"]);
      expect(listOpenAiCompatibleModels).not.toHaveBeenCalled();
      expect(selectRandomModel).not.toHaveBeenCalled();
      const writes = writtenText(response);
      expect(writes).toContain("Recovered");
    });

    // The trailing comma must not add an empty model to the ladder, which
    // would end the request after two attempts instead of four.
    it("walks the configured list a second time before giving up", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", "model-a,model-b,");
      streamEveryCall(() => streamOf([]));

      const response = await sendRequestThroughTimers();

      expect(requestedModels()).toEqual([
        "model-a",
        "model-b",
        "model-a",
        "model-b",
      ]);
      expect(response.statusCode).toBe(503);
    });

    // A single pinned model used to fail on its first error, since there was no
    // other model to move to.
    it("retries a single configured model once", async () => {
      vi.mocked(streamText)
        .mockImplementationOnce(() => streamOf([]) as never)
        .mockImplementationOnce(() => answerStream("Second try") as never);

      const response = await sendRequestThroughTimers();

      expect(requestedModels()).toEqual(["test-model", "test-model"]);
      const writes = writtenText(response);
      expect(writes).toContain("Second try");
    });

    it("emits SSE frames on successful stream", async () => {
      streamEveryCall(() => answerStream("Hello"));
      const response = await sendRequest();
      expect(response.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        "no-store",
      );
      expect(response.setHeader).not.toHaveBeenCalledWith(
        "Cache-Control",
        "no-cache",
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

    it("passes on why the upstream stopped, so a cut answer is not reported as complete", async () => {
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "text-delta", text: "Cut" },
            { type: "finish", finishReason: "length" },
          ]) as never,
      );
      const response = await sendRequest();

      const writes = writtenText(response);
      expect(writes).toContain('"finish_reason":"length"');
      expect(writes).not.toContain('"finish_reason":"stop"');
    });

    it("spells the finish reason the way OpenAI does", async () => {
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "finish", finishReason: "content-filter" },
          ]) as never,
      );
      const response = await sendRequest();

      const writes = writtenText(response);
      expect(writes).toContain('"finish_reason":"content_filter"');
    });

    it.each([
      [undefined, 8192],
      ["100", 100],
      ["8k", 8192],
    ])(
      "clamps max_tokens to MODEL_DEFAULT_MAX_TOKENS=%s, which gives %i",
      async (maxTokens, expected) => {
        vi.stubEnv("MODEL_DEFAULT_MAX_TOKENS", maxTokens);
        vi.spyOn(console, "error").mockImplementation(() => {});
        streamEveryCall(() => answerStream("Ok"));
        const callArgs = await upstreamArgsFor({
          max_tokens: 9999,
        });
        expect(callArgs.maxOutputTokens).toBe(expected);
      },
    );

    it("passes max_tokens unchanged when under cap", async () => {
      streamEveryCall(() => answerStream("Ok"));
      const callArgs = await upstreamArgsFor({
        max_tokens: 100,
      });
      expect(callArgs.maxOutputTokens).toBe(100);
    });

    it("passes undefined maxOutputTokens when max_tokens not provided", async () => {
      streamEveryCall(() => answerStream("Ok"));
      await sendRequest();
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
        streamEveryCall(() => streamOf([{ type: "finish" }]));
        const callArgs = await upstreamArgsFor({
          [reqKey]: 0,
        });
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
        streamEveryCall(() => streamOf([{ type: "finish" }]));
        const callArgs = await upstreamArgsFor({
          [reqKey]: reqValue,
        });
        expect(callArgs[argKey]).toBe(clampedTo);
      },
    );

    it("emits error SSE when stream ends without finish", async () => {
      streamEveryCall(() =>
        streamOf([{ type: "text-delta", text: "Partial" }]),
      );
      const response = await sendRequest();
      const writeCalls = response.write.mock.calls.map((c) => c[0]);
      expect(
        writeCalls.some((s: string) => s.includes("Stream ended unexpectedly")),
      ).toBe(true);
    });

    it.each([
      [undefined, 30_000],
      ["5000", 5000],
    ])(
      "aborts the upstream stream when no part arrives within MODEL_REQUEST_TIMEOUT_MS=%s (%i ms)",
      async (timeout, timeoutMs) => {
        vi.stubEnv("MODEL_REQUEST_TIMEOUT_MS", timeout);
        vi.mocked(streamText).mockImplementation(
          ({ abortSignal }: { abortSignal?: AbortSignal } = {}) =>
            stallUntilAborted(abortSignal, [
              { type: "text-delta", text: "Half" },
            ]) as never,
        );

        const handler = getRegisteredHandler();
        const response = createResponse();
        vi.useFakeTimers();
        try {
          const pending = handler(
            createRequest({ messages: [{ role: "user", content: "hi" }] }),
            response,
            vi.fn(),
          );
          // Not yet past the timeout — signal should be clear.
          await vi.advanceTimersByTimeAsync(timeoutMs - 1);
          expect(
            vi.mocked(streamText).mock.calls[0][0].abortSignal?.aborted,
          ).toBe(false);
          // Past the timeout — signal should be set and the abort part emitted.
          await vi.advanceTimersByTimeAsync(2);
          await pending;

          // The abort is treated as an attempt failure: the stalled stream is
          // cut and the SSE error frame carries the message.
          const writes = writtenFrames(response);
          expect(
            writes.some((s: string) => s.includes("Service unavailable")),
          ).toBe(true);
          expect(writes.some((s: string) => s.includes("stalled"))).toBe(true);
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it("retries the next model when the first model stalls before any content", async () => {
      useTwoRandomModels();

      vi.mocked(streamText).mockImplementationOnce(
        ({ abortSignal }: { abortSignal?: AbortSignal } = {}) =>
          stallUntilAborted(abortSignal) as never,
      );
      vi.mocked(streamText).mockImplementationOnce(
        () => answerStream("Recovered") as never,
      );

      vi.useFakeTimers();
      try {
        const { response, pending } = startRequest();
        // Advance past the idle timeout; model-a stalls and aborts.
        await vi.runAllTimersAsync();
        await pending;

        expect(streamText).toHaveBeenCalledTimes(2);
        const writes = writtenFrames(response);
        expect(writes.some((s: string) => s.includes("Recovered"))).toBe(true);
        expect(writes.some((s: string) => s.includes("stalled"))).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("responds 503 JSON when the stream ends before any content", async () => {
      streamEveryCall(() => streamOf([]));
      const response = await sendRequest();
      expect(response.statusCode).toBe(503);
      const payload = endPayload(response);
      expect(payload.lastError).toBe("Stream ended unexpectedly");
      expect(response.write).not.toHaveBeenCalled();
    });

    it("retries with another model when the stream ends before any content", async () => {
      useTwoRandomModels();

      streamFirstThen(
        () => streamOf([]),
        () => answerStream("Recovered"),
      );

      const writes = await sendExpectingSecondAttemptToRecover();
      expect(writes).not.toContain("Stream ended unexpectedly");
    });

    it("returns early when response is no longer writable", async () => {
      streamEveryCall(() => streamOf([{ type: "text-delta", text: "Hello" }]));
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
      expect(response.setHeader).not.toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
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
      const response = await sendRequest();
      const writes = writtenText(response);
      expect(writes).toContain("all models failed: upstream exploded");
      expect(writes).not.toContain("Stream ended unexpectedly");
    });

    it("retries with another model when the stream errors before any content", async () => {
      useTwoRandomModels();

      streamFirstThen(
        () =>
          streamOf([{ type: "error", error: new Error("upstream exploded") }]),
        () => answerStream("Recovered"),
      );

      const writes = await sendExpectingSecondAttemptToRecover();
      expect(writes).not.toContain("all models failed");
    });

    it("responds 503 JSON when the only model's stream fails before any content", async () => {
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "error", error: new Error("upstream down") },
          ]) as never,
      );
      const response = await sendRequest();
      expectAllModelsFailedJson(response, "upstream down");
      expect(response.setHeader).not.toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(response.write).not.toHaveBeenCalled();
      // The first attempt and its one retry.
      expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    });

    it("responds 503 JSON when the only model cannot start", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        throw new Error("upstream down");
      });
      const response = await sendRequest();
      expectAllModelsFailedJson(response, "upstream down");
      expect(response.write).not.toHaveBeenCalled();
      expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    });

    it("retries on model failure and succeeds on second attempt", async () => {
      useTwoRandomModels();

      let callCount = 0;
      vi.mocked(streamText).mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("upstream down");
        }
        return answerStream("Ok") as never;
      });

      const response = await sendRequestThroughTimers();

      expect(streamText).toHaveBeenCalledTimes(2);
      const secondCallArgs = vi.mocked(selectRandomModel).mock.calls[1][1];
      expect(secondCallArgs).toBeInstanceOf(Set);
      expect((secondCallArgs as Set<string>).has("model-a")).toBe(true);
      const writeCalls = response.write.mock.calls.map((c) => c[0]);
      expect(writeCalls.some((s: string) => s.includes("[DONE]"))).toBe(true);
    });

    it("does not retry after content was already sent to the client", async () => {
      useTwoRandomModels();

      streamFirstThen(
        () =>
          streamOf([
            { type: "text-delta", text: "Half an answer" },
            { type: "error", error: new Error("upstream exploded") },
          ]),
        () => answerStream("A different answer"),
      );

      const response = await sendRequest();

      expect(streamText).toHaveBeenCalledTimes(1);
      const writes = writtenText(response);
      expect(writes).not.toContain("A different answer");
      expect(writes).toContain("all models failed");
      expect(writes).toContain("[DONE]");
    });

    it("re-lists the model pool when every model has been attempted", async () => {
      useOneModelPoolsThatRelist();

      streamFirstThen(
        () => streamOf([{ type: "error", error: new Error("upstream down") }]),
        () => answerStream("Recovered"),
      );

      const writes = await sendExpectingSecondAttemptToRecover();
      expect(listOpenAiCompatibleModels).toHaveBeenCalledTimes(2);
      expect(writes).not.toContain("all models failed");
    });

    it("does not re-list when a model remains in the pool", async () => {
      useTwoRandomModels();

      streamFirstThen(
        () => streamOf([{ type: "error", error: new Error("upstream down") }]),
        () => answerStream("Recovered"),
      );

      await sendRequestThroughTimers();

      expect(listOpenAiCompatibleModels).toHaveBeenCalledTimes(1);
      expect(streamText).toHaveBeenCalledTimes(2);
    });

    it("re-lists only once even when both the original and refetched pools fail", async () => {
      useOneModelPoolsThatRelist();

      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "error", error: new Error("upstream down") },
          ]) as never,
      );

      const before = getInferenceStats();
      const response = await sendRequestThroughTimers();

      // The pool was refreshed once; even though both models failed we do not
      // loop on a failing /models endpoint.
      expect(listOpenAiCompatibleModels).toHaveBeenCalledTimes(2);
      expect(vi.mocked(selectRandomModel).mock.calls[1][0]).toEqual([
        { id: "model-b" },
      ]);
      expect(response.statusCode).toBe(503);
      expect(getInferenceStats().modelsRefetched).toBe(
        before.modelsRefetched + 1,
      );
    });

    it("still answers 503 when the mid-retry re-list fails", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
      vi.mocked(listOpenAiCompatibleModels)
        .mockResolvedValueOnce([{ id: "model-a" }])
        .mockRejectedValueOnce(new Error("models endpoint down"));
      vi.mocked(selectRandomModel).mockReturnValueOnce("model-a");

      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "error", error: new Error("upstream down") },
          ]) as never,
      );

      const before = getInferenceStats();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.useFakeTimers();
      try {
        const { response, pending } = startRequest();
        await vi.runAllTimersAsync();
        await pending;

        // The re-list failed, so the picker hands out nothing and the request
        // ends in the all-models-failed answer, not an internal error.
        expect(listOpenAiCompatibleModels).toHaveBeenCalledTimes(2);
        // The failed re-list left the old pool in place.
        expect(vi.mocked(selectRandomModel).mock.calls[1][0]).toEqual([
          { id: "model-a" },
        ]);
        expect(streamText).toHaveBeenCalledTimes(1);
        expect(response.statusCode).toBe(503);
        expect(getInferenceStats().failed.failedBeforeFirstToken).toBe(
          before.failed.failedBeforeFirstToken + 1,
        );
        expect(warnSpy).toHaveBeenCalledWith(
          "Failed to refetch models:",
          "models endpoint down",
        );
      } finally {
        vi.useRealTimers();
        warnSpy.mockRestore();
      }
    });

    it("responds 500 when model list fetch fails and no env model set", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
      vi.mocked(listOpenAiCompatibleModels).mockRejectedValue(
        new Error("network error"),
      );
      const response = await sendRequest();
      expect(response.statusCode).toBe(500);
      const payload = endPayload(response);
      expect(payload.error).toBe("Failed to fetch available models");
    });

    it("responds 500 when model list is empty and no env model set", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", undefined);
      vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([]);
      vi.mocked(selectRandomModel).mockReturnValue(null);
      const response = await sendRequest();
      expect(response.statusCode).toBe(500);
      const payload = endPayload(response);
      expect(payload.error).toBe("No model available");
    });

    describe("error logging", () => {
      it("logs only the error message when a stream fails", async () => {
        vi.mocked(streamText).mockImplementation(
          () =>
            streamOf([
              { type: "error", error: new Error("upstream exploded") },
            ]) as never,
        );
        const errorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        try {
          await sendRequest();
          expectOnlyMessageLogged(
            errorSpy,
            "Error during streaming:",
            "upstream exploded",
          );
        } finally {
          errorSpy.mockRestore();
        }
      });

      it("logs only the error message on unexpected endpoint failure", async () => {
        vi.mocked(streamText).mockImplementation(() => {
          throw new Error("upstream down");
        });
        const errorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        try {
          const handler = getRegisteredHandler();
          const response = createResponse();
          let thrown = false;
          response.setHeader.mockImplementation((name: string) => {
            if (!thrown && name === "Content-Type") {
              thrown = true;
              throw new Error("setHeader exploded");
            }
          });
          await handler(
            createRequest({ messages: [{ role: "user", content: "hi" }] }),
            response,
            vi.fn(),
          );
          expectOnlyMessageLogged(
            errorSpy,
            "Error in internal API endpoint:",
            "setHeader exploded",
          );
          expect(response.statusCode).toBe(500);
        } finally {
          errorSpy.mockRestore();
        }
      });

      it("logs only the error message when the model list fetch fails", async () => {
        failModelListing();
        const errorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        try {
          const response = await sendRequest();
          expectOnlyMessageLogged(
            errorSpy,
            "Error fetching models:",
            "registry timeout",
          );
          expect(response.statusCode).toBe(500);
        } finally {
          errorSpy.mockRestore();
        }
      });
    });
  });
  describe("inference counters", () => {
    async function callInference(response = createResponse()) {
      const handler = getRegisteredHandler();
      await handler(
        createRequest({ messages: [{ role: "user", content: "hi" }] }),
        response,
        vi.fn(),
      );
      return response;
    }

    beforeEach(configureStreamingApi);

    // Every case in this block goes through the handler, so this covers all of
    // them rather than whichever one happened to run last.
    afterAll(() => {
      expect(getInferenceStats().failed.unclassified).toBe(0);
    });

    it("counts a finished answer under its model", async () => {
      const before = getInferenceStats(["test-model"]);
      streamEveryCall(() => answerStream("Hello"));

      await callInference();

      const after = getInferenceStats(["test-model"]);
      expect(after.streamed).toBe(before.streamed + 1);
      expect(after.requests).toBe(before.requests + 1);
      expect(after.averageAttempts).toBeGreaterThan(0);
      expect(after.byModel[0].attempted).toBe(
        (before.byModel[0]?.attempted ?? 0) + 1,
      );
      expect(after.byModel[0].streamed).toBe(
        (before.byModel[0]?.streamed ?? 0) + 1,
      );
    });

    it("counts a request the client walked away from", async () => {
      const before = getInferenceStats();
      streamEveryCall(() => streamOf([{ type: "text-delta", text: "Hello" }]));
      const response = createResponse();
      const mutable = response as {
        writableEnded: boolean;
        destroyed: boolean;
      };
      mutable.writableEnded = true;
      mutable.destroyed = true;

      await callInference(response);

      // The only outcome with no response to observe it by, which is the
      // reason it is worth counting at all.
      expect(getInferenceStats().failed.abandoned).toBe(
        before.failed.abandoned + 1,
      );
    });

    it("counts an attempt the client walked away from mid-answer", async () => {
      const before = getInferenceStats(["test-model"]);
      const response = createResponse();
      const mutable = response as {
        writableEnded: boolean;
        destroyed: boolean;
      };
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "text-delta", text: "Half an answer" },
            { type: "text-delta", text: "never read" },
          ]) as never,
      );
      response.write.mockImplementation(() => {
        // Writable for the first part, gone before the second, which is the
        // path that leaves a model attempted with no result of its own.
        mutable.writableEnded = true;
        mutable.destroyed = true;
        return true;
      });

      await callInference(response);

      const after = getInferenceStats(["test-model"]);
      expect(after.failed.abandoned).toBe(before.failed.abandoned + 1);
      const model = after.byModel[0];
      expect(model.abandoned).toBe((before.byModel[0]?.abandoned ?? 0) + 1);
      expect(model.attempted).toBe(
        model.streamed + model.failed + model.abandoned,
      );
    });

    it("counts an exhausted ladder as a failure before the first token", async () => {
      const before = getInferenceStats(["test-model"]);
      streamEveryCall(() => streamOf([]));

      const response = await callInference();

      expect(response.statusCode).toBe(503);
      const after = getInferenceStats(["test-model"]);
      expect(after.failed.failedBeforeFirstToken).toBe(
        before.failed.failedBeforeFirstToken + 1,
      );
      // Per attempt: the single configured model was tried twice.
      expect(after.streamsEndedWithoutFinish).toBe(
        before.streamsEndedWithoutFinish + 2,
      );
      expect(after.byModel[0].failed).toBe(
        (before.byModel[0]?.failed ?? 0) + 2,
      );
      // A retry of the same model is not a move to another model.
      expect(after.modelFallbacks).toBe(before.modelFallbacks);
    });

    it("counts each failed attempt under its reason", async () => {
      vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", "model-a,model-b");
      const httpError = (statusCode: number) =>
        new APICallError({
          message: `HTTP ${statusCode}`,
          url: "http://test-api/chat/completions",
          requestBodyValues: {},
          statusCode,
        });
      for (const error of [
        httpError(429),
        httpError(503),
        httpError(400),
        new Error("socket hang up"),
      ]) {
        vi.mocked(streamText).mockImplementationOnce(
          () => streamOf([{ type: "error", error }]) as never,
        );
      }
      const before = getInferenceStats().attemptFailures;

      vi.useFakeTimers();
      try {
        const pending = callInference();
        await vi.runAllTimersAsync();
        await pending;
      } finally {
        vi.useRealTimers();
      }

      const after = getInferenceStats().attemptFailures;
      expect(after.rateLimited).toBe(before.rateLimited + 1);
      expect(after.serverError).toBe(before.serverError + 1);
      expect(after.otherHttpError).toBe(before.otherHttpError + 1);
      expect(after.other).toBe(before.other + 1);
      expect(after.stalled).toBe(before.stalled);
    });

    it("counts a failure after content as a mid-stream failure", async () => {
      const before = getInferenceStats();
      vi.mocked(streamText).mockImplementation(
        () =>
          streamOf([
            { type: "text-delta", text: "Half an answer" },
            { type: "error", error: new Error("upstream died") },
          ]) as never,
      );

      await callInference();

      expect(getInferenceStats().failed.failedMidStream).toBe(
        before.failed.failedMidStream + 1,
      );
    });

    it("counts a fallback to another model", async () => {
      const before = getInferenceStats(["model-a", "model-b"]);
      useTwoRandomModels();
      let calls = 0;
      vi.mocked(streamText).mockImplementation(() => {
        calls += 1;
        return (
          calls === 1 ? streamOf([]) : answerStream("Recovered")
        ) as never;
      });

      vi.useFakeTimers();
      try {
        const handler = getRegisteredHandler();
        const pending = handler(
          createRequest({ messages: [{ role: "user", content: "hi" }] }),
          createResponse(),
          vi.fn(),
        );
        await vi.runAllTimersAsync();
        await pending;
      } finally {
        vi.useRealTimers();
      }

      const after = getInferenceStats(["model-a", "model-b"]);
      expect(after.modelFallbacks).toBe(before.modelFallbacks + 1);
      expect(after.byModel[0].failed).toBe(
        (before.byModel[0]?.failed ?? 0) + 1,
      );
      expect(after.byModel[1].streamed).toBe(
        (before.byModel[1]?.streamed ?? 0) + 1,
      );
      expect(after.streamed).toBe(before.streamed + 1);
    });

    it.each([
      [
        "badRequest",
        async () => {
          const handler = getRegisteredHandler();
          const request = Readable.from(["{invalid"]) as IncomingMessage;
          request.url = "/inference?token=abc";
          request.method = "POST";
          request.headers = {
            host: "localhost:3000",
            "content-type": "application/json",
          };
          await handler(request, createResponse(), vi.fn());
        },
      ],
      [
        "notConfigured",
        async () => {
          vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL", undefined);
          await callInference();
        },
      ],
      [
        "modelListUnavailable",
        async () => {
          failModelListing();
          const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
          try {
            await callInference();
          } finally {
            errorSpy.mockRestore();
          }
        },
      ],
    ] as const)(
      "counts a %s answer under its own outcome",
      async (outcome, run) => {
        const before = getInferenceStats();

        await run();

        expect(getInferenceStats().failed[outcome]).toBe(
          before.failed[outcome] + 1,
        );
      },
    );

    it("counts every request exactly once and classifies all of them", async () => {
      const before = getInferenceStats();
      streamEveryCall(() => answerStream("Hello"));

      await callInference();
      await callInference();

      const stats = getInferenceStats();
      const total =
        stats.streamed +
        Object.values(stats.failed).reduce((sum, count) => sum + count, 0);

      expect(stats.requests).toBe(before.requests + 2);
      expect(total).toBe(stats.requests);
      expect(stats.averageAttempts).toBeGreaterThanOrEqual(1);
    });

    it("keeps no part of the conversation", async () => {
      streamEveryCall(() => answerStream("borogoves"));
      const handler = getRegisteredHandler();
      await handler(
        createRequest({
          messages: [{ role: "user", content: "outgrabe mimsy-42" }],
        }),
        createResponse(),
        vi.fn(),
      );

      const serialized = JSON.stringify(getInferenceStats());
      expect(serialized).not.toContain("outgrabe");
      expect(serialized).not.toContain("borogoves");
      expect(serialized).not.toContain("abc");
    });
  });
});

describe("internalApiEndpointServerHook with a malformed Host header", () => {
  it("answers 400 and keeps the handler promise from rejecting", async () => {
    vi.mocked(handleTokenVerification).mockClear();
    const request = createRequest({ messages: [] });
    request.headers.host = "bad host";
    const response = createResponse();
    const next = vi.fn();

    await expect(
      getRegisteredHandler()(request, response, next),
    ).resolves.toBeUndefined();

    expect(response.statusCode).toBe(400);
    expect(handleTokenVerification).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
