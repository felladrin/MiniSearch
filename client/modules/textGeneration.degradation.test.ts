import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const state = {
    query: "",
    response: "",
    textGenerationState: "idle",
    textSearchState: "idle",
    textSearchResults: [] as unknown[],
    llmTextSearchResults: [] as unknown[],
    pageContents: {} as Record<string, string>,
    searchRunId: "run-1",
    staleFlag: false,
    searchPromise: Promise.resolve({}) as Promise<unknown>,
    settings: {
      inferenceType: "internal",
      enableAiResponse: false,
      enableTextSearch: true,
      enableImageSearch: false,
      enableNotificationOnAiComplete: false,
      enablePageContentFetch: false,
      allowAiModelDownload: true,
      searchResultsLimit: 10,
    },
  };

  return {
    state,
    stateTransitions: [] as string[],
    /** Lets a test drive a mid-stream interruption from a response update. */
    onResponseUpdate: { current: (_value: string) => {} },
  };
});

vi.mock("./pubSub", () => ({
  getConversationSummary: () => ({ conversationId: "", summary: "" }),
  getLlmTextSearchResults: () => harness.state.llmTextSearchResults,
  getPageContents: () => harness.state.pageContents,
  getQuery: () => harness.state.query,
  getResponse: () => harness.state.response,
  getSettings: () => harness.state.settings,
  getTextGenerationState: () => harness.state.textGenerationState,
  listenToSettingsChanges: vi.fn(),
  updateChatMessages: vi.fn(),
  updateConversationSummary: vi.fn(),
  updateImageSearchResults: vi.fn(),
  updateImageSearchState: vi.fn(),
  updateLlmTextSearchResults: (results: unknown[]) => {
    harness.state.llmTextSearchResults = results;
  },
  updatePageContents: (contents: Record<string, string>) => {
    harness.state.pageContents = contents;
  },
  updateResponse: (value: string) => {
    harness.state.response = value;
    harness.onResponseUpdate.current(value);
  },
  updateSearchPromise: (promise: Promise<unknown>) => {
    harness.state.searchPromise = promise;
  },
  updateTextGenerationState: (value: string) => {
    harness.state.textGenerationState = value;
    harness.stateTransitions.push(value);
  },
  updateTextSearchResults: (results: unknown[]) => {
    harness.state.textSearchResults = results;
  },
  updateTextSearchState: (value: string) => {
    harness.state.textSearchState = value;
  },
  updateTextSearchStale: vi.fn((value: boolean) => {
    harness.state.staleFlag = value;
  }),
  getTextSearchStale: () => harness.state.staleFlag,
}));

vi.mock("./config", () => ({
  FALLBACK_CONFIG: {},
  getConfig: vi.fn(() => Promise.resolve({})),
}));

vi.mock("./history", () => ({
  getCurrentSearchRunId: vi.fn(() => harness.state.searchRunId),
  saveLlmResponseForQuery: vi.fn(() => Promise.resolve()),
  updateSearchResults: vi.fn(() => Promise.resolve()),
}));

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));

vi.mock("./notifications", () => ({ showAiCompleteNotification: vi.fn() }));

vi.mock("./pageContent", () => ({
  fetchPageContents: vi.fn(() => Promise.resolve({})),
}));

vi.mock("./search", () => ({
  searchImages: vi.fn(() => Promise.resolve({ results: [], stale: false })),
  searchText: vi.fn(() => Promise.resolve({ results: [], stale: false })),
}));

vi.mock("./searchTokenHash", () => ({
  getSearchTokenHash: vi.fn().mockResolvedValue("mock-token"),
}));

vi.mock("./systemPrompt", () => ({
  getSystemPrompt: vi.fn(() => "system prompt"),
}));

vi.mock("./textGenerationUtilities", () => ({
  ChatGenerationError: class ChatGenerationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ChatGenerationError";
    }
  },
  canStartResponding: vi.fn().mockResolvedValue(undefined),
  defaultContextSize: 4096,
  getDefaultChatCompletionCreateParamsStreaming: vi.fn(() => ({
    max_tokens: 1000,
  })),
  getFormattedSearchResults: vi.fn(() => "None."),
  imageResultTag: "(image) ",
  searchResultsToConsider: 6,
}));

vi.mock("gpt-tokenizer", () => ({
  default: { encode: vi.fn(() => [1, 2, 3]) },
}));

import { saveLlmResponseForQuery } from "./history";
import { fetchPageContents } from "./pageContent";
import { updateTextSearchStale } from "./pubSub";
import { searchImages, searchText } from "./search";
import { searchAndRespond } from "./textGeneration";
import type { ImageSearchResults, TextSearchResults } from "./types";

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

describe("search degradation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.query = "which programming language should beginners learn";
    harness.state.response = "";
    harness.state.textGenerationState = "idle";
    harness.state.textSearchState = "idle";
    harness.state.textSearchResults = [];
    harness.state.llmTextSearchResults = [];
    harness.state.staleFlag = false;
    harness.state.settings.enableAiResponse = false;
    harness.state.settings.enableTextSearch = true;
    harness.state.settings.enableImageSearch = false;
    harness.stateTransitions.length = 0;
    harness.onResponseUpdate.current = () => {};
  });

  it("falls back to a keyword-only query when the first search comes back empty", async () => {
    const fallbackResults: TextSearchResults = [
      ["Beginner languages", "A snippet", "https://example.com"],
    ];
    vi.mocked(searchText)
      .mockResolvedValueOnce({ results: [], stale: false })
      .mockResolvedValueOnce({ results: fallbackResults, stale: false });

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(searchText).toHaveBeenCalledTimes(2);
    const [firstQuery] = vi.mocked(searchText).mock.calls[0];
    const [fallbackQuery] = vi.mocked(searchText).mock.calls[1];
    expect(firstQuery).toBe(harness.state.query);
    expect(fallbackQuery).not.toBe(harness.state.query);
    expect(fallbackQuery.split(" ").length).toBeLessThan(
      harness.state.query.split(" ").length,
    );
    expect(harness.state.textSearchResults).toEqual(fallbackResults);
    expect(harness.state.textSearchState).toBe("completed");
  });

  it("keeps the text search completed when the keyword fallback is also empty", async () => {
    vi.mocked(searchText).mockResolvedValue({ results: [], stale: false });

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(searchText).toHaveBeenCalledTimes(2);
    expect(harness.state.textSearchResults).toEqual([]);
    expect(harness.state.textSearchState).toBe("completed");
  });

  it("grounds the LLM on image results when the text search fails", async () => {
    vi.mocked(searchText).mockRejectedValue(
      new Error("HTTP error! status: 502"),
    );
    // The grounding only happens for the answer path.
    harness.state.settings.enableAiResponse = true;
    vi.mocked(searchImages).mockResolvedValue({
      results: [
        [
          "Image A",
          "https://img.example.com/a",
          "thumb",
          "https://img.example.com/a",
        ],
        [
          "Image B",
          "https://img.example.com/b",
          "thumb",
          "https://img.example.com/b",
        ],
      ],
      stale: false,
    });
    harness.state.settings.enableImageSearch = true;

    const responded = searchAndRespond();
    // The grounding has to wait for the awaited image search, so the channel
    // is only populated once the search promise settles.
    await responded;
    await harness.state.searchPromise;

    expect(harness.state.textSearchState).toBe("failed");
    expect(harness.state.llmTextSearchResults).toEqual([
      ["(image) Image A", "", "https://img.example.com/a"],
      ["(image) Image B", "", "https://img.example.com/b"],
    ]);

    // The tagged line as the prompt actually renders it, through the real
    // formatter.
    const { getFormattedSearchResults } = await vi.importActual<
      typeof import("./textGenerationUtilities")
    >("./textGenerationUtilities");
    const promptResults = getFormattedSearchResults(true);
    expect(promptResults).toContain(
      "\u2022 [(image) Image A](https://img.example.com/a) | ",
    );
    expect(promptResults).toContain("image search fallback");
  });

  it("marks completed results as stale when the live search degraded to the cache", async () => {
    vi.mocked(searchText).mockResolvedValue({
      results: [["T", "S", "https://example.com"]],
      stale: true,
    });

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(harness.state.textSearchState).toBe("completed");
    // The banner is about the final state: the reset publishes false first,
    // so only the last call says anything about what is on screen.
    expect(vi.mocked(updateTextSearchStale)).toHaveBeenLastCalledWith(true);

    // The UI saying the results are stale is not enough: the prompt the LLM
    // is built from has to carry the same caveat, through the real formatter.
    const { getFormattedSearchResults } = await vi.importActual<
      typeof import("./textGenerationUtilities")
    >("./textGenerationUtilities");
    expect(getFormattedSearchResults(true)).toContain(
      "cached from an earlier search",
    );
  });

  it("lets a newer search keep the grounding channel when an older image fallback resolves last", async () => {
    // Run 1: text fails, image in flight.
    vi.mocked(searchText).mockRejectedValueOnce(
      new Error("HTTP error! status: 502"),
    );
    let releaseImages: (value: {
      results: ImageSearchResults;
      stale: boolean;
    }) => void = () => {};
    vi.mocked(searchImages).mockReturnValueOnce(
      new Promise<{ results: ImageSearchResults; stale: boolean }>(
        (resolve) => {
          releaseImages = resolve;
        },
      ),
    );
    harness.state.settings.enableAiResponse = true;
    harness.state.settings.enableImageSearch = true;

    const first = searchAndRespond();
    await vi.waitFor(() => expect(searchImages).toHaveBeenCalled());

    // Run 2 (a retry): text succeeds and repopulates the channel.
    harness.state.query = "retry query";
    vi.mocked(searchText).mockResolvedValueOnce({
      results: [["Fresh", "snippet", "https://fresh.example.com"]],
      stale: false,
    });
    const second = searchAndRespond();
    await second;
    await harness.state.searchPromise;

    // Run 1's image search now lands, after run 2 already owns the channel.
    releaseImages({
      results: [
        ["Late", "https://late.example.com", "t", "https://late.example.com"],
      ],
      stale: false,
    });
    // Let run 1's in-flight continuation fully drain: without the guard its
    // publish lands on later microtasks, after the test's own `await` has
    // resumed, so asserting without draining would race the very write the
    // guard blocks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await first;

    expect(harness.state.llmTextSearchResults).toEqual([
      ["Fresh", "snippet", "https://fresh.example.com"],
    ]);
  });

  it("keeps restored grounding when an older image fallback resolves after a restore", async () => {
    vi.mocked(searchText).mockRejectedValueOnce(
      new Error("HTTP error! status: 502"),
    );
    let releaseImages:
      | ((value: { results: ImageSearchResults; stale: boolean }) => void)
      | undefined;
    vi.mocked(searchImages).mockReturnValueOnce(
      new Promise<{ results: ImageSearchResults; stale: boolean }>(
        (resolve) => {
          releaseImages = resolve;
        },
      ),
    );
    harness.state.settings.enableAiResponse = true;
    harness.state.settings.enableImageSearch = true;

    const first = searchAndRespond();
    await vi.waitFor(() => expect(searchImages).toHaveBeenCalled());

    // A history restore changes the run id without starting a new search, so
    // the invocation counter alone cannot invalidate the in-flight fallback.
    harness.state.searchRunId = "run-2";
    harness.state.llmTextSearchResults = [
      ["Restored", "snippet", "https://restored.example.com"],
    ];

    releaseImages?.({
      results: [
        ["Late", "https://late.example.com", "t", "https://late.example.com"],
      ],
      stale: false,
    });
    // The publish sits behind the awaited image search; drain the
    // continuation before asserting, as in the cross-run test above.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await first;

    expect(harness.state.llmTextSearchResults).toEqual([
      ["Restored", "snippet", "https://restored.example.com"],
    ]);
  });

  it("marks the text search as failed when the search request errors", async () => {
    vi.mocked(searchText).mockRejectedValue(
      new Error("HTTP error! status: 502"),
    );
    harness.state.settings.enableImageSearch = true;

    // A previous search left the LLM grounding channel populated; the failed
    // search must clear it so the AI can't ground on stale results.
    harness.state.llmTextSearchResults = [
      ["Stale result", "Old snippet", "https://stale.example.com"],
    ];

    await searchAndRespond();
    await harness.state.searchPromise;

    // An outage is not an empty result set: the keyword fallback must not
    // fire, the search ends failed so the retry UI shows up, and the stale
    // grounding is dropped.
    expect(searchText).toHaveBeenCalledTimes(1);
    expect(harness.state.textSearchResults).toEqual([]);
    expect(harness.state.llmTextSearchResults).toEqual([]);
    expect(harness.state.textSearchState).toBe("failed");
  });
});

describe("page content grounding", () => {
  const textResults: TextSearchResults = Array.from({ length: 8 }, (_, i) => [
    `Result ${i}`,
    `Snippet ${i}`,
    `https://example.com/${i}`,
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.query = "how do cats sleep";
    harness.state.pageContents = {};
    harness.state.searchRunId = "run-1";
    harness.state.settings.enableAiResponse = false;
    harness.state.settings.enableImageSearch = false;
    harness.state.settings.enableTextSearch = true;
    harness.state.settings.enablePageContentFetch = true;
    vi.mocked(searchText).mockResolvedValue({
      results: textResults,
      stale: false,
    });
  });

  /** Holds the page read open so a test can observe what happens meanwhile. */
  function deferPageRead() {
    let release: (contents: Record<string, string>) => void = () => {};
    vi.mocked(fetchPageContents).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    return (contents: Record<string, string> = {}) => release(contents);
  }

  it("starts image search without waiting for the pages to be read", async () => {
    const releasePageRead = deferPageRead();
    harness.state.settings.enableAiResponse = true;
    harness.state.settings.enableImageSearch = true;
    mockFetch.mockResolvedValue(
      sseStream([contentFrame("Answer"), "data: [DONE]\n"]),
    );

    const responded = searchAndRespond();
    await vi.waitFor(() => expect(searchImages).toHaveBeenCalled());

    releasePageRead();
    await responded;
    await harness.state.searchPromise;
  });

  it("drops a read that lands after a newer search took over", async () => {
    const releasePageRead = deferPageRead();
    harness.state.settings.enableAiResponse = true;
    mockFetch.mockResolvedValue(
      sseStream([contentFrame("Answer"), "data: [DONE]\n"]),
    );

    const responded = searchAndRespond();
    await vi.waitFor(() => expect(fetchPageContents).toHaveBeenCalled());

    harness.state.searchRunId = "run-2";
    releasePageRead({ "https://example.com/0": "text from the old search" });

    await responded;
    await harness.state.searchPromise;

    expect(harness.state.pageContents).toEqual({});
  });

  it("reads only the results that reach the prompt", async () => {
    vi.mocked(fetchPageContents).mockResolvedValue({
      "https://example.com/0": "What the first page says.",
    });
    harness.state.settings.enableAiResponse = true;
    mockFetch.mockResolvedValue(
      sseStream([contentFrame("Answer"), "data: [DONE]\n"]),
    );

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(fetchPageContents).toHaveBeenCalledWith(
      harness.state.query,
      textResults.slice(0, 6).map(([, , url]) => url),
    );
    expect(harness.state.pageContents).toEqual({
      "https://example.com/0": "What the first page says.",
    });
  });

  it("does not read any page while the setting is off", async () => {
    harness.state.settings.enableAiResponse = true;
    harness.state.settings.enablePageContentFetch = false;
    mockFetch.mockResolvedValue(
      sseStream([contentFrame("Answer"), "data: [DONE]\n"]),
    );

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(fetchPageContents).not.toHaveBeenCalled();
  });

  it("does not read any page when the answer is not AI-generated", async () => {
    await searchAndRespond();
    await harness.state.searchPromise;

    expect(fetchPageContents).not.toHaveBeenCalled();
  });

  it("still completes the search when no page could be read", async () => {
    vi.mocked(fetchPageContents).mockResolvedValue({});
    harness.state.settings.enableAiResponse = true;
    mockFetch.mockResolvedValue(
      sseStream([contentFrame("Answer"), "data: [DONE]\n"]),
    );

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(harness.state.textSearchState).toBe("completed");
    expect(harness.state.pageContents).toEqual({});
    expect(harness.state.textGenerationState).toBe("completed");
  });
});

describe("inference degradation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.query = "test query";
    harness.state.response = "";
    harness.state.textGenerationState = "idle";
    harness.state.settings.enableAiResponse = true;
    harness.state.settings.enableTextSearch = false;
    harness.stateTransitions.length = 0;
    harness.onResponseUpdate.current = () => {};
  });

  it("ends in a failed state when /inference answers 503", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 503 }));

    await searchAndRespond();

    expect(harness.state.textGenerationState).toBe("failed");
    expect(harness.stateTransitions).not.toContain("completed");
    expect(harness.state.response).toBe("");
    expect(saveLlmResponseForQuery).not.toHaveBeenCalled();
  });

  it("keeps the partial answer when the stream is aborted mid-generation", async () => {
    mockFetch.mockResolvedValue(
      sseStream([
        contentFrame("Partial "),
        contentFrame("answer"),
        contentFrame(" that never arrives"),
        "data: [DONE]\n",
      ]),
    );
    harness.onResponseUpdate.current = (value: string) => {
      if (value === "Partial answer") {
        harness.state.textGenerationState = "interrupted";
      }
    };

    await searchAndRespond();

    expect(harness.state.response).toBe("Partial answer");
    expect(harness.state.textGenerationState).toBe("interrupted");
    expect(harness.stateTransitions).not.toContain("failed");
    expect(harness.stateTransitions).not.toContain("completed");
  });
});
