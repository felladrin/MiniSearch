import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const state = {
    query: "",
    response: "",
    textGenerationState: "idle",
    textSearchState: "idle",
    textSearchResults: [] as unknown[],
    imageSearchResults: [] as unknown[],
    llmTextSearchResults: [] as unknown[],
    pageContents: {} as Record<string, string>,
    searchRunId: "run-1",
    staleFlag: false,
    suppressNextFollowUp: false,
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

import {
  contentFrame,
  historyMock,
  logEntriesMock,
  notificationsMock,
  pageContentMock,
  sseStream,
  wllamaMock,
} from "./textGenerationTestUtils";

vi.mock("./pubSub", () => ({
  getImageSearchResults: () => harness.state.imageSearchResults,
  getConversationSummary: () => ({ conversationId: "", summary: "" }),
  getLlmTextSearchResults: () => harness.state.llmTextSearchResults,
  getPageContents: () => harness.state.pageContents,
  getQuery: () => harness.state.query,
  getResponse: () => harness.state.response,
  getSettings: () => harness.state.settings,
  getTextGenerationState: () => harness.state.textGenerationState,
  listenToSettingsChanges: vi.fn(() => vi.fn()),
  listenToTextGenerationStateChanges: vi.fn(() => vi.fn()),
  updateChatMessages: vi.fn(),
  updateConversationSummary: vi.fn(),
  updateImageSearchResults: vi.fn((results: unknown[]) => {
    harness.state.imageSearchResults = results;
  }),
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
  updateResponseImmediately: (value: string) => {
    harness.state.response = value;
    harness.onResponseUpdate.current(value);
  },
  updateSearchPromise: (promise: Promise<unknown>) => {
    harness.state.searchPromise = promise;
  },
  updateSuppressNextFollowUp: (value: boolean) => {
    harness.state.suppressNextFollowUp = value;
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

vi.mock("./history", () => historyMock(() => harness.state.searchRunId));

vi.mock("./logEntries", () => logEntriesMock());

vi.mock("./notifications", () => notificationsMock());

vi.mock("./pageContent", () => pageContentMock());

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
  // Mirror of the real getDefaultChatMessages shape; the prompts and query come
  // from the harness state so assertions on the streamed flow keep working.
  getDefaultChatMessages: (_searchResults: string) => [
    { role: "user", content: "system prompt" },
    { role: "assistant", content: "Ok!" },
    { role: "user", content: harness.state.query },
  ],
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

vi.mock("./textGenerationWithWllama", () => wllamaMock());

import {
  mergeSearchImageResults,
  saveLlmResponseForQuery,
  updateSearchResults,
} from "./history";
import { fetchPageContents } from "./pageContent";
import {
  listenToSettingsChanges,
  updateImageSearchResults,
  updateImageSearchState,
  updateTextSearchStale,
} from "./pubSub";
import { searchImages, searchText } from "./search";
import { interruptSearch, searchAndRespond } from "./textGeneration";
import { generateTextWithWllama } from "./textGenerationWithWllama";
import type { ImageSearchResults, TextSearchResults } from "./types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** Makes the search endpoint reject a blank query, as the real one does. */
function stubEmptyQueryRejection() {
  vi.mocked(searchText).mockImplementation(async (query) => {
    if (!query.trim()) {
      throw new Error("Query cannot be empty or whitespace only");
    }
    return { results: [], stale: false };
  });
}

const LATE_IMAGE_RESULTS: ImageSearchResults = [
  ["Late", "https://late.example.com", "t", "https://late.example.com"],
];

/**
 * Fails the text search and holds the image search open, with the AI response
 * and the image search on. Returns the function that releases the held search.
 */
function failTextAndHoldImages() {
  vi.mocked(searchText).mockRejectedValueOnce(
    new Error("HTTP error! status: 502"),
  );
  let release:
    | ((value: { results: ImageSearchResults; stale: boolean }) => void)
    | undefined;
  vi.mocked(searchImages).mockReturnValueOnce(
    new Promise<{ results: ImageSearchResults; stale: boolean }>((resolve) => {
      release = resolve;
    }),
  );
  harness.state.settings.enableAiResponse = true;
  harness.state.settings.enableImageSearch = true;
  return () => release?.({ results: LATE_IMAGE_RESULTS, stale: false });
}

/** Lets an in-flight continuation drain before the next assertion. */
async function drainContinuations() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Queues run B: its own query, run id and text results. */
function queueSecondSearch() {
  const resultsB: TextSearchResults = [
    ["B title", "B snippet", "https://b.example"],
  ];
  harness.state.query = "search b";
  harness.state.searchRunId = "run-b";
  vi.mocked(searchText).mockResolvedValueOnce({
    results: resultsB,
    stale: false,
  });
  return resultsB;
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

  it("grounds the answer on the best-scored results while the list keeps the pinned one first", async () => {
    const scoredResults: TextSearchResults = [
      ["Pinned", "A snippet", "https://pinned.example", 12],
      ["Relevant", "A snippet", "https://relevant.example", 91],
      ["Weak", "A snippet", "https://weak.example", 20],
    ];
    vi.mocked(searchText).mockResolvedValueOnce({
      results: scoredResults,
      stale: false,
    });

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(harness.state.textSearchResults).toEqual(scoredResults);
    expect(
      (harness.state.llmTextSearchResults as TextSearchResults).map(
        ([title]) => title,
      ),
    ).toEqual(["Relevant", "Weak", "Pinned"]);
  });

  it("keeps the text search completed when the keyword fallback is also empty", async () => {
    vi.mocked(searchText).mockResolvedValue({ results: [], stale: false });

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(searchText).toHaveBeenCalledTimes(2);
    expect(harness.state.textSearchResults).toEqual([]);
    expect(harness.state.textSearchState).toBe("completed");
  });

  it("completes with no results when a stopword-only query leaves no keywords to retry with", async () => {
    harness.state.query = "how about that";
    stubEmptyQueryRejection();

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(searchText).toHaveBeenCalledTimes(1);
    expect(harness.state.textSearchResults).toEqual([]);
    expect(harness.state.textSearchState).toBe("completed");
  });

  it("completes without searching when an over-long query has no keywords", async () => {
    harness.state.query = "that ".repeat(401);
    stubEmptyQueryRejection();

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(searchText).not.toHaveBeenCalled();
    expect(harness.state.textSearchState).toBe("completed");
  });

  it("searches the trimmed query when an over-long query has no keywords but fits once trimmed", async () => {
    harness.state.query = `how about that${" ".repeat(2000)}`;
    vi.mocked(searchText).mockResolvedValue({ results: [], stale: false });

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(searchText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchText).mock.calls[0][0]).toBe("how about that");
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
    const promptResults = await getFormattedSearchResults(true);
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
    expect(await getFormattedSearchResults(true)).toContain(
      "cached from an earlier search",
    );
  });

  it("lets a newer search keep the grounding channel when an older image fallback resolves last", async () => {
    // Run 1: text fails, image in flight.
    const releaseLateImages = failTextAndHoldImages();

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
    releaseLateImages();
    // Let run 1's in-flight continuation fully drain: without the guard its
    // publish lands on later microtasks, after the test's own `await` has
    // resumed, so asserting without draining would race the very write the
    // guard blocks.
    await drainContinuations();
    await first;

    expect(harness.state.llmTextSearchResults).toEqual([
      ["Fresh", "snippet", "https://fresh.example.com"],
    ]);
  });

  it("keeps restored grounding when an older image fallback resolves after a restore", async () => {
    const releaseLateImages = failTextAndHoldImages();

    const first = searchAndRespond();
    await vi.waitFor(() => expect(searchImages).toHaveBeenCalled());

    // A history restore changes the run id without starting a new search, so
    // the invocation counter alone cannot invalidate the in-flight fallback.
    harness.state.searchRunId = "run-2";
    harness.state.llmTextSearchResults = [
      ["Restored", "snippet", "https://restored.example.com"],
    ];

    releaseLateImages();
    // The publish sits behind the awaited image search; drain the
    // continuation before asserting, as in the cross-run test above.
    await drainContinuations();
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

  it("resets suppressNextFollowUp so a prior restore does not suppress the next search", async () => {
    harness.state.suppressNextFollowUp = true;

    await searchAndRespond();
    await harness.state.searchPromise;

    expect(harness.state.suppressNextFollowUp).toBe(false);
  });
});

describe("search supersession ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.query = "search a";
    harness.state.response = "";
    harness.state.searchRunId = "run-a";
    harness.state.textGenerationState = "idle";
    harness.state.textSearchState = "idle";
    harness.state.textSearchResults = [];
    harness.state.imageSearchResults = [];
    harness.state.llmTextSearchResults = [];
    harness.state.pageContents = {};
    harness.state.staleFlag = false;
    harness.state.settings.enableAiResponse = false;
    harness.state.settings.enableTextSearch = true;
    harness.state.settings.enableImageSearch = false;
    harness.state.settings.enablePageContentFetch = false;
    harness.stateTransitions.length = 0;
    harness.onResponseUpdate.current = () => {};
    mockFetch.mockResolvedValue(
      sseStream([contentFrame("Answer"), "data: [DONE]\\n"]),
    );
  });

  function deferTextSearch() {
    let release: (value: {
      results: TextSearchResults;
      stale: boolean;
    }) => void = () => {};
    let fail: (error: Error) => void = () => {};
    vi.mocked(searchText).mockReturnValueOnce(
      new Promise((resolve, reject) => {
        release = resolve;
        fail = reject;
      }),
    );
    return { release, fail };
  }

  function deferImageSearch() {
    let release: (value: {
      results: ImageSearchResults;
      stale: boolean;
    }) => void = () => {};
    let fail: (error: Error) => void = () => {};
    vi.mocked(searchImages).mockReturnValueOnce(
      new Promise((resolve, reject) => {
        release = resolve;
        fail = reject;
      }),
    );
    return { release, fail };
  }

  it("keeps the newer search UI, grounding, page contents, and history untouched when a slow search resolves late", async () => {
    harness.state.settings.enableAiResponse = true;
    harness.state.settings.enablePageContentFetch = true;
    const deferredA = deferTextSearch();

    const first = searchAndRespond();
    await vi.waitFor(() => expect(searchText).toHaveBeenCalledTimes(1));

    const resultsB = queueSecondSearch();
    vi.mocked(fetchPageContents).mockResolvedValueOnce({
      "https://b.example": "B page excerpt",
    });

    const second = searchAndRespond();
    await second;
    await harness.state.searchPromise;

    const resultsA: TextSearchResults = [
      ["A title", "A snippet", "https://a.example"],
    ];
    deferredA.release({ results: resultsA, stale: true });
    await drainContinuations();
    await first;

    expect(harness.state.textSearchResults).toEqual(resultsB);
    expect(harness.state.llmTextSearchResults).toEqual(resultsB);
    expect(harness.state.textSearchState).toBe("completed");
    expect(harness.state.staleFlag).toBe(false);
    expect(harness.state.pageContents).toEqual({
      "https://b.example": "B page excerpt",
    });
    expect(fetchPageContents).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateSearchResults)).toHaveBeenCalledWith("run-b", {
      type: "text",
      items: [
        { title: "B title", url: "https://b.example", snippet: "B snippet" },
      ],
    });
    expect(vi.mocked(updateSearchResults)).toHaveBeenCalledWith("run-a", {
      type: "text",
      items: [
        { title: "A title", url: "https://a.example", snippet: "A snippet" },
      ],
    });
    expect(
      vi
        .mocked(updateSearchResults)
        .mock.calls.filter(
          ([runId, payload]) => runId === "run-b" && payload.type === "text",
        ),
    ).toHaveLength(1);
  });

  it("does not mark the newer search failed when an older search rejects late", async () => {
    const deferredA = deferTextSearch();

    const first = searchAndRespond();
    await vi.waitFor(() => expect(searchText).toHaveBeenCalledTimes(1));

    const resultsB = queueSecondSearch();

    const second = searchAndRespond();
    await second;
    await harness.state.searchPromise;

    deferredA.fail(new Error("late failure"));
    await drainContinuations();
    await first;

    expect(harness.state.textSearchState).toBe("completed");
    expect(harness.state.textSearchResults).toEqual(resultsB);
    expect(harness.state.llmTextSearchResults).toEqual(resultsB);
  });

  const followUpImage: ImageSearchResults[number] = [
    "Follow-up",
    "https://f.example/img.png",
    "thumb-f",
    "https://f.example",
  ];

  /** A search whose image search is still pending when a follow-up's images land. */
  async function searchWithFollowUpImagesFirst() {
    harness.state.settings.enableImageSearch = true;
    vi.mocked(searchText).mockResolvedValueOnce({
      results: [["A title", "A snippet", "https://a.example"]],
      stale: false,
    });
    const deferredImages = deferImageSearch();
    const running = searchAndRespond();
    await vi.waitFor(() => expect(searchImages).toHaveBeenCalledTimes(1));
    harness.state.imageSearchResults = [followUpImage];
    return {
      finishImages: async (results: ImageSearchResults) => {
        deferredImages.release({ results, stale: false });
        await drainContinuations();
        await running;
      },
    };
  }

  it("starts the run's stored image list over for a new attempt", async () => {
    await searchAndRespond();

    expect(vi.mocked(updateSearchResults)).toHaveBeenCalledWith("run-a", {
      type: "image",
      items: [],
    });
  });

  it("keeps the images a follow-up added while the first image search was still running", async () => {
    const { finishImages } = await searchWithFollowUpImagesFirst();

    const firstImage: ImageSearchResults[number] = [
      "First",
      "https://a.example/img.png",
      "thumb-a",
      "https://a.example",
    ];
    await finishImages([firstImage]);

    expect(vi.mocked(updateImageSearchResults)).toHaveBeenLastCalledWith([
      followUpImage,
      firstImage,
    ]);
    expect(vi.mocked(mergeSearchImageResults)).toHaveBeenCalledWith(
      "run-a",
      {
        type: "image",
        items: [
          {
            title: "Follow-up",
            url: "https://f.example/img.png",
            thumbnail: "thumb-f",
            sourceUrl: "https://f.example",
          },
          {
            title: "First",
            url: "https://a.example/img.png",
            thumbnail: "thumb-a",
            sourceUrl: "https://a.example",
          },
        ],
      },
      { newFirst: false },
    );
  });

  it("keeps the first search's image from the same page as a follow-up's", async () => {
    const { finishImages } = await searchWithFollowUpImagesFirst();

    const samePageImage: ImageSearchResults[number] = [
      "Same page",
      followUpImage[1],
      "thumb-other",
      "https://f.example/other",
    ];
    await finishImages([samePageImage]);

    expect(vi.mocked(updateImageSearchResults)).toHaveBeenLastCalledWith([
      followUpImage,
      samePageImage,
    ]);
  });

  it("keeps a follow-up's images when the first image search finds none", async () => {
    const { finishImages } = await searchWithFollowUpImagesFirst();
    await finishImages([]);

    expect(vi.mocked(updateImageSearchResults)).toHaveBeenLastCalledWith([
      followUpImage,
    ]);
  });

  it("keeps fire-and-forget image search results and state from an older search out of the newer search", async () => {
    harness.state.settings.enableImageSearch = true;
    vi.mocked(searchText).mockResolvedValueOnce({
      results: [["A title", "A snippet", "https://a.example"]],
      stale: false,
    });
    const deferredImagesA = deferImageSearch();

    const first = searchAndRespond();
    await vi.waitFor(() => expect(searchImages).toHaveBeenCalledTimes(1));

    const imagesB: ImageSearchResults = [
      ["Img B", "https://b.example/img.png", "thumb-b", "https://b.example"],
    ];
    queueSecondSearch();
    vi.mocked(searchImages).mockResolvedValueOnce({
      results: imagesB,
      stale: false,
    });

    const second = searchAndRespond();
    await second;
    await harness.state.searchPromise;
    await drainContinuations();

    const imagesA: ImageSearchResults = [
      ["Img A", "https://a.example/img.png", "thumb-a", "https://a.example"],
    ];
    deferredImagesA.release({ results: imagesA, stale: false });
    await drainContinuations();
    await first;

    expect(vi.mocked(updateImageSearchResults)).toHaveBeenLastCalledWith(
      imagesB,
    );
    expect(vi.mocked(updateImageSearchResults)).not.toHaveBeenCalledWith(
      imagesA,
    );
    expect(vi.mocked(updateImageSearchState)).toHaveBeenLastCalledWith(
      "completed",
    );
    expect(
      vi
        .mocked(updateImageSearchState)
        .mock.calls.filter(([state]) => state === "completed"),
    ).toHaveLength(1);
    // Search A was left, so its images are added to its own stored list.
    expect(vi.mocked(mergeSearchImageResults)).toHaveBeenCalledWith(
      "run-a",
      {
        type: "image",
        items: [
          {
            title: "Img A",
            url: "https://a.example/img.png",
            thumbnail: "thumb-a",
            sourceUrl: "https://a.example",
          },
        ],
      },
      { newFirst: false },
    );
    expect(
      vi
        .mocked(mergeSearchImageResults)
        .mock.calls.filter(([runId]) => runId === "run-b"),
    ).toHaveLength(1);
  });

  it("ignores late image failures on both fire-and-forget and fallback paths", async () => {
    harness.state.settings.enableAiResponse = true;
    harness.state.settings.enableImageSearch = true;
    vi.mocked(searchText).mockRejectedValueOnce(new Error("text failed"));
    const deferredImagesA = deferImageSearch();

    const first = searchAndRespond();
    await vi.waitFor(() => expect(searchImages).toHaveBeenCalledTimes(1));

    queueSecondSearch();
    vi.mocked(searchImages).mockResolvedValueOnce({
      results: [
        ["Img B", "https://b.example/img.png", "thumb-b", "https://b.example"],
      ],
      stale: false,
    });

    const second = searchAndRespond();
    await second;
    await harness.state.searchPromise;
    await drainContinuations();

    deferredImagesA.fail(new Error("late image error"));
    await drainContinuations();
    await first;

    expect(vi.mocked(updateImageSearchState)).not.toHaveBeenCalledWith(
      "failed",
    );

    vi.clearAllMocks();
    harness.state.settings.enableAiResponse = false;
    harness.state.query = "search c";
    harness.state.searchRunId = "run-c";
    vi.mocked(searchText).mockResolvedValueOnce({
      results: [["C title", "C snippet", "https://c.example"]],
      stale: false,
    });
    const deferredImagesC = deferImageSearch();
    const third = searchAndRespond();
    await vi.waitFor(() => expect(searchImages).toHaveBeenCalledTimes(1));

    harness.state.query = "search d";
    harness.state.searchRunId = "run-d";
    vi.mocked(searchText).mockResolvedValueOnce({
      results: [["D title", "D snippet", "https://d.example"]],
      stale: false,
    });
    vi.mocked(searchImages).mockResolvedValueOnce({
      results: [
        ["Img D", "https://d.example/img.png", "thumb-d", "https://d.example"],
      ],
      stale: false,
    });
    const fourth = searchAndRespond();
    await fourth;
    await harness.state.searchPromise;
    await drainContinuations();

    deferredImagesC.fail(new Error("late fire-and-forget image error"));
    await drainContinuations();
    await third;

    expect(vi.mocked(updateImageSearchState)).not.toHaveBeenCalledWith(
      "failed",
    );
  });

  it("blocks a superseded attempt from publishing or overwriting history after a retry on the same run", async () => {
    const deferredFirst = deferTextSearch();

    const first = searchAndRespond();
    await vi.waitFor(() => expect(searchText).toHaveBeenCalledTimes(1));

    const retryResults: TextSearchResults = [
      ["Retry", "Retry snippet", "https://retry.example"],
    ];
    vi.mocked(searchText).mockResolvedValueOnce({
      results: retryResults,
      stale: false,
    });

    const retry = searchAndRespond();
    await retry;
    await harness.state.searchPromise;

    deferredFirst.release({
      results: [["Old", "Old snippet", "https://old.example"]],
      stale: true,
    });
    await drainContinuations();
    await first;

    expect(harness.state.textSearchResults).toEqual(retryResults);
    expect(harness.state.llmTextSearchResults).toEqual(retryResults);
    expect(harness.state.staleFlag).toBe(false);
    expect(
      vi
        .mocked(updateSearchResults)
        .mock.calls.filter(([, payload]) => payload.type === "text"),
    ).toHaveLength(1);
    expect(vi.mocked(updateSearchResults)).toHaveBeenCalledWith("run-a", {
      type: "text",
      items: [
        {
          title: "Retry",
          url: "https://retry.example",
          snippet: "Retry snippet",
        },
      ],
    });
  });

  it("stops a late search from publishing UI state after a history restore changes the run id", async () => {
    const deferredA = deferTextSearch();

    const first = searchAndRespond();
    await vi.waitFor(() => expect(searchText).toHaveBeenCalledTimes(1));

    const restoredResults: TextSearchResults = [
      ["Restored", "Restored snippet", "https://restored.example"],
    ];
    harness.state.searchRunId = "run-restored";
    harness.state.textSearchResults = restoredResults;
    harness.state.llmTextSearchResults = restoredResults;
    harness.state.textSearchState = "completed";
    harness.state.staleFlag = false;

    deferredA.release({
      results: [["Late A", "Late snippet", "https://late.example"]],
      stale: true,
    });
    await drainContinuations();
    await first;

    expect(harness.state.textSearchResults).toEqual(restoredResults);
    expect(harness.state.llmTextSearchResults).toEqual(restoredResults);
    expect(harness.state.textSearchState).toBe("completed");
    expect(harness.state.staleFlag).toBe(false);
    expect(vi.mocked(updateSearchResults)).toHaveBeenCalledWith("run-a", {
      type: "text",
      items: [
        {
          title: "Late A",
          url: "https://late.example",
          snippet: "Late snippet",
        },
      ],
    });
    expect(vi.mocked(updateSearchResults)).not.toHaveBeenCalledWith(
      "run-restored",
      expect.anything(),
    );
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

  it("loads the browser model once when two searches wait for the download allowance", async () => {
    const settings = harness.state.settings;
    settings.inferenceType = "browser";
    settings.allowAiModelDownload = false;
    const listeners: ((value: typeof settings) => void)[] = [];
    vi.mocked(listenToSettingsChanges).mockImplementation((listener) => {
      listeners.push(listener as (value: typeof settings) => void);
      return vi.fn();
    });

    try {
      const first = searchAndRespond();
      const second = searchAndRespond();
      await vi.waitFor(() => expect(listeners).toHaveLength(2));

      settings.allowAiModelDownload = true;
      for (const listener of listeners) listener(settings);
      await Promise.all([first, second]);
    } finally {
      settings.inferenceType = "internal";
      settings.allowAiModelDownload = true;
    }

    expect(generateTextWithWllama).toHaveBeenCalledTimes(1);
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
      if (value === "Partial answer") interruptSearch();
    };

    await searchAndRespond();

    expect(harness.state.response).toBe("Partial answer");
    expect(harness.state.textGenerationState).toBe("interrupted");
    expect(harness.stateTransitions).not.toContain("failed");
    expect(harness.stateTransitions).not.toContain("completed");
  });
});
