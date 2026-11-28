import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "@shared/openaiModels";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "@/modules/logEntries";
import {
  getSettings,
  getTextGenerationState,
  updateGenerationRate,
  updateResponse,
  updateTextGenerationState,
} from "@/modules/pubSub";
import { canStartResponding } from "@/modules/textGenerationUtilities";
import { defaultSettings } from "./settings";

vi.mock("@/modules/logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.mock("@/modules/pubSub", () => ({
  getSettings: vi.fn(),
  getTextGenerationState: vi.fn().mockReturnValue("idle"),
  updateGenerationRate: vi.fn(),
  updateResponse: vi.fn(),
  updateTextGenerationState: vi.fn(),
}));

vi.mock("@/modules/sleep", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// canStartResponding/getDefaultChatMessages/getFormattedSearchResults depend
// on pubSub state we don't want to drive here; getDefaultChatCompletionCreateParamsStreaming
// is mocked too so tests don't depend on real settings-derived defaults.
vi.mock("@/modules/textGenerationUtilities", () => ({
  canStartResponding: vi.fn().mockResolvedValue(undefined),
  getDefaultChatMessages: vi
    .fn()
    .mockReturnValue([{ role: "user", content: "hi" }]),
  getFormattedSearchResults: vi.fn().mockReturnValue("None."),
  getDefaultChatCompletionCreateParamsStreaming: vi.fn().mockReturnValue({
    max_tokens: 1000,
    temperature: 0.35,
    top_p: 1.0,
  }),
}));

vi.mock("@shared/openaiModels", () => ({
  listOpenAiCompatibleModels: vi.fn().mockResolvedValue([]),
  selectRandomModel: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/**
 * A stream without a `finish_reason` counts as truncated, and the provider
 * turns that into an error part, so the closing chunk is part of a well-formed
 * response and only the truncation test leaves it out.
 */
function sseResponse(lines: unknown[], { truncated = false } = {}) {
  const chunks = truncated
    ? lines
    : [...lines, { choices: [{ delta: {}, finish_reason: "stop" }] }];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * An event stream that stays open until the test sends `close`, so a request
 * can be caught while it is still waiting on the server. Aborting the fetch
 * errors the body the way a browser does.
 */
function heldOpenSseResponse(init: RequestInit | undefined) {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  init?.signal?.addEventListener("abort", () => {
    controller.error(new DOMException("aborted", "AbortError"));
  });
  const send = (chunk: unknown) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    send,
    close: () => {
      send({ choices: [{ delta: {}, finish_reason: "stop" }] });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  };
}

function mockSettings(overrides: Partial<typeof defaultSettings> = {}) {
  vi.mocked(getSettings).mockReturnValue({
    ...defaultSettings,
    openAiApiBaseUrl: "https://api.example.com/v1",
    openAiApiKey: "sk-test-key",
    openAiApiModel: "gpt-4",
    reasoningStartMarker: "<think>",
    reasoningEndMarker: "</think>",
    ...overrides,
  });
}

describe("textGenerationWithOpenAi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTextGenerationState).mockReturnValue("idle");
    mockSettings();
  });

  describe("generateTextWithOpenAi", () => {
    /**
     * Answers "Hello" over a held-open stream whose two deltas arrive 5 seconds
     * apart, so the answer's own span is known, and ends it after `lastChunk`.
     */
    async function streamTimedDeltas(lastChunk: unknown) {
      let now = 0;
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
      const streams: ReturnType<typeof heldOpenSseResponse>[] = [];
      mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
        const stream = heldOpenSseResponse(init);
        streams.push(stream);
        return Promise.resolve(stream.response);
      });

      try {
        const { generateTextWithOpenAi } = await import(
          "./textGenerationWithOpenAi"
        );
        const answer = generateTextWithOpenAi();
        await vi.waitFor(() => expect(streams).toHaveLength(1));

        now = 1000;
        streams[0].send({ choices: [{ delta: { content: "Hel" } }] });
        await vi.waitFor(() =>
          expect(updateResponse).toHaveBeenCalledWith("Hel"),
        );
        now = 6000;
        streams[0].send({ choices: [{ delta: { content: "lo" } }] });
        await vi.waitFor(() =>
          expect(updateResponse).toHaveBeenCalledWith("Hello"),
        );

        if (lastChunk) streams[0].send(lastChunk);
        streams[0].close();
        await expect(answer).resolves.toBe("Hello");
      } finally {
        nowSpy.mockRestore();
      }
    }

    it("publishes the speed from the completion count the backend reports", async () => {
      await streamTimedDeltas({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 42, total_tokens: 52 },
      });

      // 42 completion tokens across the 5 seconds between the first delta and
      // the last, not across the whole request.
      expect(updateGenerationRate).toHaveBeenCalledWith("8.4 tokens/s");
    });

    it("publishes no speed when the backend reports no usage", async () => {
      await streamTimedDeltas(undefined);

      // A delta is not a token, so nothing here counts them exactly.
      expect(updateGenerationRate).toHaveBeenCalledWith(undefined);
    });

    it("streams a text response and updates state", async () => {
      const { generateTextWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      mockFetch.mockResolvedValueOnce(
        sseResponse([{ choices: [{ delta: { content: "Hello" } }] }]),
      );

      await expect(generateTextWithOpenAi()).resolves.toBe("Hello");

      expect(canStartResponding).toHaveBeenCalled();
      expect(updateTextGenerationState).toHaveBeenCalledWith(
        "preparingToGenerate",
      );
      expect(updateTextGenerationState).toHaveBeenCalledWith("generating");
      expect(updateResponse).toHaveBeenCalledWith("Hello");
    });

    it("wraps reasoning content with the configured markers ahead of the text", async () => {
      const { generateTextWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      mockFetch.mockResolvedValueOnce(
        sseResponse([
          { choices: [{ delta: { reasoning_content: "Thinking..." } }] },
          { choices: [{ delta: { content: "Hello" } }] },
        ]),
      );

      await expect(generateTextWithOpenAi()).resolves.toBe(
        "<think>Thinking...</think>\n\nHello",
      );

      expect(updateResponse).toHaveBeenLastCalledWith(
        "<think>Thinking...</think>\n\nHello",
      );
    });
  });

  describe("generateChatWithOpenAi", () => {
    it("resolves with the generated text and streams it to the callback", async () => {
      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      mockFetch.mockResolvedValueOnce(
        sseResponse([{ choices: [{ delta: { content: "Hello" } }] }]),
      );

      const onUpdate = vi.fn();
      const result = await generateChatWithOpenAi(
        [{ role: "user", content: "Hi" }],
        onUpdate,
      );

      expect(result).toBe("Hello");
      expect(onUpdate).toHaveBeenCalledWith("Hello");
      expect(canStartResponding).not.toHaveBeenCalled();
    });

    it("throws once generation is interrupted", async () => {
      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      mockFetch.mockResolvedValueOnce(
        sseResponse([
          { choices: [{ delta: { content: "partial" } }] },
          { choices: [{ delta: { content: " answer" } }] },
        ]),
      );
      const controller = new AbortController();
      const onUpdate = vi.fn(() => controller.abort());

      await expect(
        generateChatWithOpenAi(
          [{ role: "user", content: "Hi" }],
          onUpdate,
          controller.signal,
        ),
      ).rejects.toThrow("Chat generation interrupted");
    });

    it("retries with a different model when the stream reports an error", async () => {
      mockSettings({ openAiApiModel: "" });
      vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([
        { id: "model-a" },
        { id: "model-b" },
      ]);
      vi.mocked(selectRandomModel)
        .mockReturnValueOnce("model-a")
        .mockReturnValueOnce("model-b");

      let call = 0;
      mockFetch.mockImplementation(async () => {
        call++;
        if (call === 1) {
          return sseResponse([{ error: { message: "model overloaded" } }]);
        }
        return sseResponse([
          { choices: [{ delta: { content: "recovered" } }] },
        ]);
      });

      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );
      const result = await generateChatWithOpenAi(
        [{ role: "user", content: "Hi" }],
        vi.fn(),
      );

      expect(result).toBe("recovered");
      expect(call).toBe(2);
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining('retrying with "model-b"'),
      );
    });

    it("keeps the content already streamed when the stream is truncated", async () => {
      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      mockFetch.mockResolvedValueOnce(
        sseResponse([{ choices: [{ delta: { content: "partial" } }] }], {
          truncated: true,
        }),
      );

      const result = await generateChatWithOpenAi(
        [{ role: "user", content: "Hi" }],
        vi.fn(),
      );

      expect(result).toBe("partial");
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("keeping what arrived"),
      );
    });

    it("does not stop when the shared state says interrupted", async () => {
      // The state belongs to the search answer; a chat with its own signal
      // that was not aborted has to finish.
      vi.mocked(getTextGenerationState).mockReturnValue("interrupted");
      mockFetch.mockResolvedValueOnce(
        sseResponse([{ choices: [{ delta: { content: "Hello" } }] }]),
      );
      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      await expect(
        generateChatWithOpenAi(
          [{ role: "user", content: "Hi" }],
          vi.fn(),
          new AbortController().signal,
        ),
      ).resolves.toBe("Hello");
    });

    it("aborts only the request of the chat whose signal aborts", async () => {
      const streams: ReturnType<typeof heldOpenSseResponse>[] = [];
      const fetchSignals: (AbortSignal | null | undefined)[] = [];
      mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
        const stream = heldOpenSseResponse(init);
        streams.push(stream);
        fetchSignals.push(init?.signal);
        return Promise.resolve(stream.response);
      });
      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      const first = generateChatWithOpenAi(
        [{ role: "user", content: "First" }],
        vi.fn(),
        new AbortController().signal,
      );
      const secondController = new AbortController();
      const second = generateChatWithOpenAi(
        [{ role: "user", content: "Second" }],
        vi.fn(),
        secondController.signal,
      );
      await vi.waitFor(() => expect(streams).toHaveLength(2));

      const secondOutcome = expect(second).rejects.toThrow(
        "Chat generation interrupted",
      );
      secondController.abort();
      await secondOutcome;

      expect(fetchSignals[1]?.aborted).toBe(true);
      expect(fetchSignals[0]?.aborted).toBe(false);

      streams[0].send({ choices: [{ delta: { content: "First answer" } }] });
      streams[0].close();
      await expect(first).resolves.toBe("First answer");
    });

    it("stops at once when aborted before any chunk arrives", async () => {
      let stream: ReturnType<typeof heldOpenSseResponse> | undefined;
      mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
        stream = heldOpenSseResponse(init);
        return Promise.resolve(stream.response);
      });
      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );
      const controller = new AbortController();

      const chat = generateChatWithOpenAi(
        [{ role: "user", content: "Hi" }],
        vi.fn(),
        controller.signal,
      );
      await vi.waitFor(() => expect(stream).toBeDefined());
      const outcome = expect(chat).rejects.toThrow(
        "Chat generation interrupted",
      );
      // The server never sends a chunk, so only the signal can end the wait.
      controller.abort();
      await outcome;
    });

    it("gives up once no untried model is left", async () => {
      mockSettings({ openAiApiModel: "" });
      vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([
        { id: "model-a" },
      ]);
      vi.mocked(selectRandomModel).mockReturnValueOnce("model-a");

      mockFetch.mockResolvedValue(
        sseResponse([{ error: { message: "model overloaded" } }]),
      );

      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      await expect(
        generateChatWithOpenAi([{ role: "user", content: "Hi" }], vi.fn()),
      ).rejects.toThrow();
    });
  });
});
