import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  saved: [] as Array<{ query: string; response: string; model: string }>,
  responseAtCompletion: { current: null as string | null },
}));

vi.mock("./history", () => ({
  getCurrentSearchRunId: vi.fn(() => "run-1"),
  saveLlmResponseForQuery: vi.fn(
    (query: string, response: string, model: string) => {
      harness.saved.push({ query, response, model });
      return Promise.resolve();
    },
  ),
  updateSearchResults: vi.fn(() => Promise.resolve()),
}));

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));

// The internal API sizes its budgets from /api/config; `fetch` below only
// answers /inference.
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    getConfig: vi.fn(() => Promise.resolve(actual.FALLBACK_CONFIG)),
  };
});

vi.mock("./notifications", () => ({ showAiCompleteNotification: vi.fn() }));

vi.mock("./pageContent", () => ({
  fetchPageContents: vi.fn(() => Promise.resolve({})),
}));

vi.mock("./search", () => ({
  searchText: vi.fn(() =>
    Promise.resolve({
      results: [["Sky", "A snippet", "https://example.com/sky"]],
      stale: false,
    }),
  ),
  searchImages: vi.fn(() => Promise.resolve({ results: [], stale: false })),
}));

vi.mock("./searchTokenHash", () => ({
  getSearchTokenHash: vi.fn(() => Promise.resolve("mock-token")),
}));

import {
  getResponse,
  getSettings,
  queryPubSub,
  textGenerationStatePubSub,
  updateSettings,
} from "./pubSub";
import { searchAndRespond } from "./textGeneration";

const throttleInterval = 1000 / 12;

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function sseStream(frames: string[]) {
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

function contentFrame(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;
}

describe("response persistence", () => {
  beforeEach(() => {
    harness.saved.length = 0;
    harness.responseAtCompletion.current = null;
    mockFetch.mockReset();
    queryPubSub[0]("why is the sky blue");
    updateSettings({
      ...getSettings(),
      inferenceType: "internal",
      enableAiResponse: true,
      enableTextSearch: true,
      enableImageSearch: false,
      enableNotificationOnAiComplete: false,
      enablePageContentFetch: false,
    });
  });

  it("saves the full answer when the last chunk lands inside the throttle window", async () => {
    mockFetch.mockResolvedValue(
      sseStream([contentFrame("Hello"), contentFrame(" world!!! done")]),
    );

    const unsubscribe = textGenerationStatePubSub[1]((state) => {
      if (state === "completed") {
        harness.responseAtCompletion.current = getResponse();
      }
    });

    await searchAndRespond();
    unsubscribe();

    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0].response).toBe("Hello world!!! done");
    expect(harness.responseAtCompletion.current).toBe("Hello world!!! done");

    await new Promise((resolve) => setTimeout(resolve, throttleInterval * 3));

    expect(getResponse()).toBe("Hello world!!! done");
  });
});
