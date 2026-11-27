import { vi } from "vitest";

/**
 * The `./textGenerationUtilities` override shared by the per-engine generation
 * tests. The helpers that read pubSub state become mocks, so a generation test
 * does not have to drive the UI channels; everything else (`ChatGenerationError`,
 * `defaultContextSize`) stays real, so `instanceof` checks still work.
 *
 * Returns the factory rather than the object so a `vi.mock` call can stay a
 * one-liner. The call is deferred to factory time, which is after this module
 * has been evaluated: the mocked module is only reached through the dynamic
 * `await import(...)` of the module under test.
 */
export function textGenerationUtilitiesMock(
  overrides: Record<string, unknown> = {},
) {
  return async (
    importOriginal: () => Promise<typeof import("./textGenerationUtilities")>,
  ) => ({
    ...(await importOriginal()),
    canStartResponding: vi.fn().mockResolvedValue(undefined),
    getFormattedSearchResults: vi.fn().mockReturnValue("None."),
    ...overrides,
  });
}

/**
 * A `Response` that streams `frames` as SSE, the shape the OpenAI-compatible
 * and internal-API paths produce.
 */
export function sseStream(frames: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

/** One `chat.completion.chunk` delta frame carrying `content`. */
export function contentFrame(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;
}

/**
 * The `./history` override shared by the textGeneration tests: every write is
 * a resolved mock, and the run id is fixed so the supersede guards pass.
 */
export function historyMock(getCurrentSearchRunId: () => string) {
  return {
    replaceChatConversation: vi.fn(() => Promise.resolve()),
    getCurrentSearchRunId: vi.fn(getCurrentSearchRunId),
    saveLlmResponseForQuery: vi.fn(() => Promise.resolve()),
    updateSearchResults: vi.fn(() => Promise.resolve()),
    mergeSearchImageResults: vi.fn(() => Promise.resolve()),
  };
}

/** The `./logEntries` and `./notifications` overrides, with no behaviour. */
export function logEntriesMock() {
  return { addLogEntry: vi.fn() };
}

export function notificationsMock() {
  return { showAiCompleteNotification: vi.fn() };
}

/** The `./pageContent` override: every read comes back empty. */
export function pageContentMock() {
  return { fetchPageContents: vi.fn(() => Promise.resolve({})) };
}

/** The `./search` override: both searches answer with nothing. */
export function searchMock() {
  return {
    searchImages: vi.fn(() => Promise.resolve([])),
    searchText: vi.fn(() => Promise.resolve([])),
  };
}
