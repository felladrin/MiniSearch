import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

beforeEach(() => vi.clearAllMocks());

vi.mock("./search", () => ({
  searchText: vi.fn(),
  searchImages: vi.fn(),
}));
vi.mock("./history", () => ({
  getCurrentSearchRunId: vi.fn(() => "run-1"),
  replaceChatConversation: vi.fn(() => Promise.resolve()),
  updateSearchResults: vi.fn(() => Promise.resolve()),
  mergeSearchImageResults: vi.fn(() => Promise.resolve()),
}));
vi.mock("./pubSub", () => ({
  getImageSearchResults: vi.fn(() => []),
  getPageContents: vi.fn(() => ({})),
  updateImageSearchResults: vi.fn(),
  updateLlmTextSearchResults: vi.fn(),
  updatePageContents: vi.fn(),
  updateTextSearchResults: vi.fn(),
  updateTextSearchStale: vi.fn(),
  updateTextSearchTimeFilterNotApplied: vi.fn(),
}));
vi.mock("./pageContent", () => ({
  fetchPageContents: vi.fn(() => Promise.resolve({})),
}));
vi.mock("./relatedSearchQuery", () => ({
  generateRelatedSearchQuery: vi.fn(() => Promise.resolve("")),
}));
vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));
vi.mock("./textGenerationUtilities", () => ({
  searchResultsToConsider: 6,
}));

import {
  persistChatConversation,
  refreshImageSearchResults,
  refreshTextSearchResults,
  runFollowUpSearch,
} from "./chatHelpers";
import {
  getCurrentSearchRunId,
  mergeSearchImageResults,
  replaceChatConversation,
  updateSearchResults,
} from "./history";
import { fetchPageContents } from "./pageContent";
import {
  getImageSearchResults,
  getPageContents,
  updateImageSearchResults,
  updateLlmTextSearchResults,
  updatePageContents,
  updateTextSearchResults,
  updateTextSearchStale,
} from "./pubSub";
import { generateRelatedSearchQuery } from "./relatedSearchQuery";
import { searchImages, searchText } from "./search";
import { getLatestSearchAttempt, recordSearchAttempt } from "./searchAttempts";
import type { ImageSearchResults, TextSearchResults } from "./types";

const mockGetCurrentSearchRunId = vi.mocked(getCurrentSearchRunId);
const mockSearchText = vi.mocked(searchText);
const mockSearchImages = vi.mocked(searchImages);
const mockReplaceChat = vi.mocked(replaceChatConversation);
const mockUpdateSearchResults = vi.mocked(updateSearchResults);
const mockUpdateText = vi.mocked(updateTextSearchResults);
const mockUpdateImage = vi.mocked(updateImageSearchResults);
const mockUpdateLlmText = vi.mocked(updateLlmTextSearchResults);
const mockUpdateTextStale = vi.mocked(updateTextSearchStale);
const mockFetchPageContents = vi.mocked(fetchPageContents);
const mockGetPageContents = vi.mocked(getPageContents);
const mockUpdatePageContents = vi.mocked(updatePageContents);
const mockGenerateRelatedSearchQuery = vi.mocked(generateRelatedSearchQuery);

describe("refreshTextSearchResults", () => {
  it("deduplicates by URL and appends fresh results", async () => {
    const existing: TextSearchResults = [
      ["Existing", "snippet", "https://existing.com"],
    ];
    const fresh: TextSearchResults = [
      ["New", "snippet", "https://new.com"],
      ["Duplicate", "snippet", "https://existing.com"],
    ];

    mockSearchText.mockResolvedValueOnce({ results: fresh, stale: false });

    await refreshTextSearchResults("query", 10, existing);

    expect(mockUpdateText).toHaveBeenCalledWith([
      ["Existing", "snippet", "https://existing.com"],
      ["New", "snippet", "https://new.com"],
    ]);
    expect(mockUpdateTextStale).toHaveBeenCalledWith(false);
  });

  it("skips updates when all fresh results are duplicates", async () => {
    const existing: TextSearchResults = [
      ["Title", "snippet", "https://dup.com"],
    ];
    const fresh: TextSearchResults = [["Title", "snippet", "https://dup.com"]];

    mockSearchText.mockResolvedValueOnce({ results: fresh, stale: false });

    await refreshTextSearchResults("query", 10, existing);

    expect(mockUpdateText).not.toHaveBeenCalled();
  });

  it("skips updates when there are no fresh results", async () => {
    mockSearchText.mockResolvedValueOnce({ results: [], stale: false });

    await refreshTextSearchResults("query", 10, []);

    expect(mockUpdateText).not.toHaveBeenCalled();
    expect(mockUpdateLlmText).not.toHaveBeenCalled();
    expect(mockUpdateTextStale).not.toHaveBeenCalled();
  });

  it("raises the stale banner when the fresh batch was served from the cache", async () => {
    mockSearchText.mockResolvedValueOnce({
      results: [["New", "snippet", "https://new.com"]],
      stale: true,
    });

    await refreshTextSearchResults("query", 10, []);

    expect(mockUpdateTextStale).toHaveBeenCalledWith(true);
  });

  it("orders the answer's evidence by score, not by the displayed order", async () => {
    mockSearchText.mockResolvedValueOnce({
      results: [
        ["Pinned", "snippet", "https://pinned.com", 12],
        ["Relevant", "snippet", "https://relevant.com", 91],
        ["Weak", "snippet", "https://weak.com", 20],
      ],
      stale: false,
    });

    await refreshTextSearchResults("query", 10, []);

    expect(
      mockUpdateLlmText.mock.calls[0]?.[0].map(([title]) => title),
    ).toEqual(["Relevant", "Weak", "Pinned"]);
  });
});

describe("refreshImageSearchResults", () => {
  it("keeps a fresh image from the same page as one on screen", async () => {
    const existing: ImageSearchResults = [
      [
        "First",
        "https://gallery.com",
        "https://gallery.com/first-thumb.jpg",
        "https://gallery.com/first.jpg",
      ],
    ];
    const fresh: ImageSearchResults = [
      [
        "Second",
        "https://gallery.com",
        "https://gallery.com/second-thumb.jpg",
        "https://gallery.com/second.jpg",
      ],
    ];
    mockSearchImages.mockResolvedValueOnce({ results: fresh, stale: false });

    await refreshImageSearchResults("query", 10, existing);

    expect(mockUpdateImage).toHaveBeenCalledWith([...fresh, ...existing]);
  });

  it("drops a fresh copy of an image on screen and prepends the rest", async () => {
    const existing: ImageSearchResults = [
      [
        "Existing",
        "https://existing.com",
        "thumb",
        "https://existing.com/full.jpg",
      ],
    ];
    const fresh: ImageSearchResults = [
      ["New", "https://new.com", "thumb", "https://new.com/full.jpg"],
      [
        "Duplicate",
        "https://existing.com",
        "thumb",
        "https://existing.com/full.jpg",
      ],
    ];

    mockSearchImages.mockResolvedValueOnce({ results: fresh, stale: false });

    await refreshImageSearchResults("query", 10, existing);

    expect(mockUpdateImage).toHaveBeenCalledWith([
      ["New", "https://new.com", "thumb", "https://new.com/full.jpg"],
      [
        "Existing",
        "https://existing.com",
        "thumb",
        "https://existing.com/full.jpg",
      ],
    ]);
  });

  it("keeps the first search's images that landed after the follow-up started", async () => {
    const firstImages: ImageSearchResults = [
      ["First", "https://first.com", "thumb", "https://first.com/full.jpg"],
    ];
    const fresh: ImageSearchResults = [
      ["New", "https://new.com", "thumb", "https://new.com/full.jpg"],
    ];
    mockSearchImages.mockResolvedValueOnce({ results: fresh, stale: false });
    // The follow-up was handed an empty list; the first images arrived since.
    vi.mocked(getImageSearchResults).mockReturnValueOnce(firstImages);

    await refreshImageSearchResults("query", 10, []);

    expect(mockUpdateImage).toHaveBeenCalledWith([...fresh, ...firstImages]);
    expect(mergeSearchImageResults).toHaveBeenCalledWith("run-1", {
      type: "image",
      items: [
        {
          title: "New",
          url: "https://new.com",
          thumbnail: "thumb",
          sourceUrl: "https://new.com/full.jpg",
        },
        {
          title: "First",
          url: "https://first.com",
          thumbnail: "thumb",
          sourceUrl: "https://first.com/full.jpg",
        },
      ],
    });
  });

  it("shows an image found by both searches once", async () => {
    const firstImages: ImageSearchResults = [
      ["First", "https://first.com", "thumb", "https://first.com/full.jpg"],
    ];
    mockSearchImages.mockResolvedValueOnce({
      results: [
        ["New", "https://new.com", "thumb", "https://new.com/full.jpg"],
        [
          "First again",
          "https://first.com",
          "thumb",
          "https://first.com/full.jpg",
        ],
      ],
      stale: false,
    });
    vi.mocked(getImageSearchResults).mockReturnValueOnce(firstImages);

    await refreshImageSearchResults("query", 10, []);

    expect(mockUpdateImage).toHaveBeenCalledWith([
      ["New", "https://new.com", "thumb", "https://new.com/full.jpg"],
      ...firstImages,
    ]);
  });

  it("skips updates when there are no fresh results", async () => {
    mockSearchImages.mockResolvedValueOnce({ results: [], stale: false });

    await refreshImageSearchResults("query", 10, []);

    expect(mockUpdateImage).not.toHaveBeenCalled();
  });
});

describe("persistChatConversation", () => {
  it("replaces the stored conversation of the given search run", async () => {
    const messages = [
      { role: "user" as const, content: "user msg" },
      { role: "assistant" as const, content: "assistant msg" },
    ];

    await persistChatConversation("run-1", messages);

    expect(mockReplaceChat).toHaveBeenCalledWith("run-1", messages);
  });
});

describe("runFollowUpSearch", () => {
  const makeSettings = (overrides = {}) =>
    ({
      enableTextSearch: true,
      enableImageSearch: true,
      enablePageContentFetch: true,
      searchResultsLimit: 10,
      searchTimeRange: "any",
      ...overrides,
    }) as unknown as Parameters<typeof runFollowUpSearch>[2];

  it("reads the pages behind the fresh results and keeps the ones already read", async () => {
    mockSearchText.mockResolvedValueOnce({
      results: [
        ["Title", "snippet", "https://new.com"],
        ["Other", "snippet", "https://other.com"],
      ],
      stale: false,
    });
    mockFetchPageContents.mockResolvedValueOnce({
      "https://new.com": "page text",
    });
    mockGetPageContents.mockReturnValueOnce({ "https://old.com": "old text" });

    await runFollowUpSearch(
      [{ role: "user", content: "hello" }],
      "hello",
      makeSettings(),
      [],
      [],
    );

    expect(mockFetchPageContents).toHaveBeenCalledWith("hello", [
      "https://new.com",
      "https://other.com",
    ]);
    expect(mockUpdatePageContents).toHaveBeenCalledWith({
      "https://old.com": "old text",
      "https://new.com": "page text",
    });
  });

  it("does not read pages when page content fetching is disabled", async () => {
    mockSearchText.mockResolvedValueOnce({
      results: [["Title", "snippet", "https://new.com"]],
      stale: false,
    });

    await runFollowUpSearch(
      [{ role: "user", content: "hello" }],
      "hello",
      makeSettings({ enablePageContentFetch: false }),
      [],
      [],
    );

    expect(mockFetchPageContents).not.toHaveBeenCalled();
  });

  it("starts the image refresh without waiting for the page read", async () => {
    mockSearchText.mockResolvedValueOnce({
      results: [["Title", "snippet", "https://new.com"]],
      stale: false,
    });
    let finishPageRead: (contents: Record<string, string>) => void = () => {};
    mockFetchPageContents.mockReturnValueOnce(
      new Promise((resolve) => {
        finishPageRead = resolve;
      }),
    );

    const followUpSearch = runFollowUpSearch(
      [{ role: "user", content: "hello" }],
      "hello",
      makeSettings(),
      [],
      [],
    );

    await vi.waitFor(() => expect(mockSearchImages).toHaveBeenCalled());
    finishPageRead({});
    await followUpSearch;
  });

  it("anchors a relative date in the follow-up query to the current year", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    mockGenerateRelatedSearchQuery.mockResolvedValueOnce(
      "new series on disney plus next month",
    );
    mockSearchText.mockResolvedValueOnce({ results: [], stale: false });

    try {
      await runFollowUpSearch(
        [{ role: "user", content: "what about next month" }],
        "what about next month",
        makeSettings(),
        [],
        [],
      );
    } finally {
      vi.useRealTimers();
    }

    const anchoredQuery = "new series on disney plus next month December 2026";
    expect(mockSearchText).toHaveBeenCalledWith(anchoredQuery, 10, "any");
    expect(mockSearchImages).toHaveBeenCalledWith(anchoredQuery, 10, "any");
  });

  it("replaces the year the model wrote with the one the question means", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    mockGenerateRelatedSearchQuery.mockResolvedValueOnce(
      "who won world series 2026",
    );
    mockSearchText.mockResolvedValueOnce({ results: [], stale: false });

    try {
      await runFollowUpSearch(
        [
          { role: "user", content: "who won the world series" },
          {
            role: "assistant",
            content: "The Dodgers won the 2026 World Series.",
          },
          { role: "user", content: "who won it last year" },
        ],
        "who won it last year",
        makeSettings(),
        [],
        [],
      );
    } finally {
      vi.useRealTimers();
    }

    expect(mockSearchText).toHaveBeenCalledWith(
      "who won world series 2025",
      10,
      "any",
    );
  });

  it("refreshes text results when enabled", async () => {
    mockSearchText.mockResolvedValueOnce({
      results: [["Title", "snippet", "https://new.com"]],
      stale: false,
    });

    await runFollowUpSearch(
      [{ role: "user", content: "hello" }],
      "hello",
      makeSettings(),
      [],
      [],
    );

    expect(mockSearchText).toHaveBeenCalled();
  });

  it("searches with at most 2000 characters when the chat input is longer", async () => {
    const longInput = "x".repeat(2001);
    mockSearchText.mockResolvedValueOnce({ results: [], stale: false });

    await runFollowUpSearch(
      [{ role: "user", content: longInput }],
      longInput,
      makeSettings({ enableImageSearch: false }),
      [],
      [],
    );

    const [query] = mockSearchText.mock.calls[0];
    expect(query.length).toBeLessThanOrEqual(2000);
  });

  it("skips text search when disabled", async () => {
    await runFollowUpSearch(
      [{ role: "user", content: "hello" }],
      "hello",
      makeSettings({ enableTextSearch: false }),
      [],
      [],
    );

    expect(mockSearchText).not.toHaveBeenCalled();
  });

  it("skips image search when disabled", async () => {
    await runFollowUpSearch(
      [{ role: "user", content: "hello" }],
      "hello",
      makeSettings({ enableImageSearch: false }),
      [],
      [],
    );

    expect(mockSearchImages).not.toHaveBeenCalled();
  });
});

describe("follow-up supersession ownership", () => {
  it("keeps a follow-up from publishing after a retry on the same run", async () => {
    let releaseText: (value: {
      results: TextSearchResults;
      stale: boolean;
    }) => void = () => {};
    mockSearchText.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseText = resolve;
      }),
    );

    const followUp = runFollowUpSearch(
      [{ role: "user", content: "follow up" }],
      "follow up",
      {
        enableTextSearch: true,
        enableImageSearch: true,
        enablePageContentFetch: true,
        searchResultsLimit: 10,
      } as unknown as Parameters<typeof runFollowUpSearch>[2],
      [],
      [],
    );
    await vi.waitFor(() => expect(mockSearchText).toHaveBeenCalledTimes(1));

    // "Regenerate response" starts a new attempt and keeps the run id.
    recordSearchAttempt("run-1", (getLatestSearchAttempt("run-1") ?? 0) + 1);
    releaseText({
      results: [["Old text", "snippet", "https://old.example"]],
      stale: false,
    });
    await followUp;

    expect(mockUpdateText).not.toHaveBeenCalled();
    expect(mockUpdateLlmText).not.toHaveBeenCalled();
    expect(mockUpdateTextStale).not.toHaveBeenCalled();
    expect(mockUpdateSearchResults).not.toHaveBeenCalled();
    expect(mockFetchPageContents).not.toHaveBeenCalled();
    expect(mockSearchImages).not.toHaveBeenCalled();
  });

  const makeSettings = (overrides = {}) =>
    ({
      enableTextSearch: true,
      enableImageSearch: true,
      enablePageContentFetch: true,
      searchResultsLimit: 10,
      searchTimeRange: "any",
      ...overrides,
    }) as unknown as Parameters<typeof runFollowUpSearch>[2];

  beforeEach(() => {
    mockGetCurrentSearchRunId.mockReturnValue("run-1");
  });

  /** Holds the next image search until the returned function releases it. */
  function holdNextImageSearch() {
    let release: (results: ImageSearchResults) => void = () => {};
    mockSearchImages.mockReturnValueOnce(
      new Promise((resolve) => {
        release = (results) => resolve({ results, stale: false });
      }),
    );
    return (results: ImageSearchResults) => release(results);
  }

  it("keeps both follow-ups' images when their refreshes land in reverse order", async () => {
    let shown: ImageSearchResults = [];
    vi.mocked(getImageSearchResults).mockImplementation(() => shown);
    mockUpdateImage.mockImplementation((results) => {
      shown = results;
    });
    onTestFinished(() => {
      vi.mocked(getImageSearchResults).mockImplementation(() => []);
      mockUpdateImage.mockImplementation(() => {});
    });

    const releaseFirst = holdNextImageSearch();

    const existingA: ImageSearchResults = [
      ["Initial", "https://initial.com", "thumb-0", "src-0"],
    ];
    shown = existingA;
    const first = refreshImageSearchResults("first", 10, existingA);
    await vi.waitFor(() => expect(mockSearchImages).toHaveBeenCalledTimes(1));

    // The second follow-up is sent before the first one's images land, so
    // the list it is handed does not have them.
    mockSearchImages.mockResolvedValueOnce({
      results: [["B1", "https://b1.com", "thumb-b1", "src-b1"]],
      stale: false,
    });
    await refreshImageSearchResults("second", 10, existingA);

    releaseFirst([["Late A", "https://a.com", "thumb-a", "src-a"]]);
    await first;

    const both: ImageSearchResults = [
      ["Late A", "https://a.com", "thumb-a", "src-a"],
      ["B1", "https://b1.com", "thumb-b1", "src-b1"],
      ...existingA,
    ];
    expect(mockUpdateImage).toHaveBeenLastCalledWith(both);
    expect(mergeSearchImageResults).toHaveBeenCalledTimes(2);
    expect(mergeSearchImageResults).toHaveBeenLastCalledWith("run-1", {
      type: "image",
      items: both.map(([title, url, thumbnail, sourceUrl]) => ({
        title,
        url,
        thumbnail,
        sourceUrl,
      })),
    });
  });

  it("drops an image refresh that lands after a retry on the same run", async () => {
    const releaseImages = holdNextImageSearch();
    const refresh = refreshImageSearchResults("query", 10, [], "run-1");
    await vi.waitFor(() => expect(mockSearchImages).toHaveBeenCalledTimes(1));

    recordSearchAttempt("run-1", (getLatestSearchAttempt("run-1") ?? 0) + 1);
    releaseImages([["Old", "https://old.com", "thumb-o", "src-o"]]);
    await refresh;

    expect(mockUpdateImage).not.toHaveBeenCalled();
    expect(mergeSearchImageResults).not.toHaveBeenCalled();
  });

  it("drops a stale text refresh that resolves after a newer text refresh on the same run", async () => {
    let releaseFirst: (value: {
      results: TextSearchResults;
      stale: boolean;
    }) => void = () => {};
    mockSearchText.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseFirst = resolve;
      }),
    );

    const first = refreshTextSearchResults("first", 10, []);
    await vi.waitFor(() => expect(mockSearchText).toHaveBeenCalledTimes(1));

    const freshB: TextSearchResults = [["B", "b snippet", "https://b.com"]];
    mockSearchText.mockResolvedValueOnce({ results: freshB, stale: false });
    await refreshTextSearchResults("second", 10, []);

    releaseFirst({
      results: [["Late A", "a snippet", "https://a.com"]],
      stale: true,
    });
    const staleOutcome = await first;

    expect(staleOutcome).toEqual([]);
    expect(mockUpdateText).toHaveBeenCalledTimes(1);
    expect(mockUpdateText).toHaveBeenCalledWith(freshB);
    expect(mockUpdateLlmText).toHaveBeenCalledTimes(1);
    expect(mockUpdateTextStale).toHaveBeenCalledTimes(1);
    expect(mockUpdateTextStale).toHaveBeenCalledWith(false);
    expect(mockUpdateSearchResults).toHaveBeenCalledTimes(1);
  });

  it("adds a late image refresh to its own run's stored images after leaving the search", async () => {
    const releaseImages = holdNextImageSearch();
    const handed: ImageSearchResults = [
      ["Shown", "https://shown.com", "thumb-s", "src-s"],
    ];
    const refresh = refreshImageSearchResults("query", 10, handed, "run-1");
    await vi.waitFor(() => expect(mockSearchImages).toHaveBeenCalledTimes(1));

    // The user restored or started another search meanwhile.
    mockGetCurrentSearchRunId.mockReturnValue("run-2");
    releaseImages([["Fresh", "https://fresh.com", "thumb-f", "src-f"]]);
    await refresh;

    expect(mockUpdateImage).not.toHaveBeenCalled();
    expect(mockUpdateSearchResults).not.toHaveBeenCalled();
    expect(mergeSearchImageResults).toHaveBeenCalledWith("run-1", {
      type: "image",
      items: [
        {
          title: "Fresh",
          url: "https://fresh.com",
          thumbnail: "thumb-f",
          sourceUrl: "src-f",
        },
        {
          title: "Shown",
          url: "https://shown.com",
          thumbnail: "thumb-s",
          sourceUrl: "src-s",
        },
      ],
    });
  });

  it("keeps a follow-up refresh from touching screen or new run history after a new search starts", async () => {
    let releaseText: (value: {
      results: TextSearchResults;
      stale: boolean;
    }) => void = () => {};
    let releaseImages: (value: {
      results: ImageSearchResults;
      stale: boolean;
    }) => void = () => {};
    mockSearchText.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseText = resolve;
      }),
    );
    mockSearchImages.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseImages = resolve;
      }),
    );

    const followUp = runFollowUpSearch(
      [{ role: "user", content: "follow up" }],
      "follow up",
      makeSettings(),
      [],
      [],
    );
    await vi.waitFor(() => expect(mockSearchText).toHaveBeenCalledTimes(1));

    mockGetCurrentSearchRunId.mockReturnValue("run-2");

    releaseText({
      results: [["Old text", "snippet", "https://old.example"]],
      stale: true,
    });
    await followUp;

    expect(mockSearchImages).not.toHaveBeenCalled();
    expect(mockUpdateText).not.toHaveBeenCalled();
    expect(mockUpdateLlmText).not.toHaveBeenCalled();
    expect(mockUpdateTextStale).not.toHaveBeenCalled();
    expect(mockUpdateImage).not.toHaveBeenCalled();
    expect(mockFetchPageContents).not.toHaveBeenCalled();
    expect(mockUpdateSearchResults).not.toHaveBeenCalledWith(
      "run-2",
      expect.anything(),
    );
    expect(mockUpdateSearchResults).toHaveBeenCalledWith("run-1", {
      type: "text",
      items: [
        { title: "Old text", url: "https://old.example", snippet: "snippet" },
      ],
    });

    mockGetCurrentSearchRunId.mockReturnValue("run-1");
    const imageFollowUp = runFollowUpSearch(
      [{ role: "user", content: "follow up images" }],
      "follow up images",
      makeSettings({ enableTextSearch: false }),
      [],
      [],
    );
    await vi.waitFor(() => expect(mockSearchImages).toHaveBeenCalledTimes(1));

    mockGetCurrentSearchRunId.mockReturnValue("run-2");
    releaseImages({
      results: [
        ["Old img", "https://old.example/img.png", "t", "https://old.example"],
      ],
      stale: false,
    });
    await imageFollowUp;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockUpdateImage).not.toHaveBeenCalled();
    expect(mockUpdateSearchResults).not.toHaveBeenCalledWith(
      "run-2",
      expect.anything(),
    );
  });

  it("prevents an older follow-up waiting on query generation from superseding a newer follow-up", async () => {
    let releaseRelatedQueryA: (query: string) => void = () => {};
    mockGenerateRelatedSearchQuery.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseRelatedQueryA = resolve;
      }),
    );

    const followUpA = runFollowUpSearch(
      [{ role: "user", content: "old follow up" }],
      "old follow up",
      makeSettings({ enablePageContentFetch: false }),
      [],
      [],
    );
    await vi.waitFor(() =>
      expect(mockGenerateRelatedSearchQuery).toHaveBeenCalledTimes(1),
    );

    mockGenerateRelatedSearchQuery.mockResolvedValueOnce("new follow up");
    mockSearchText.mockResolvedValueOnce({
      results: [["New", "new snippet", "https://new.example"]],
      stale: false,
    });
    mockSearchImages.mockResolvedValueOnce({
      results: [
        ["New img", "https://new.example/img.png", "t", "https://new.example"],
      ],
      stale: false,
    });

    await runFollowUpSearch(
      [{ role: "user", content: "new follow up" }],
      "new follow up",
      makeSettings({ enablePageContentFetch: false }),
      [],
      [],
    );

    releaseRelatedQueryA("old follow up");
    await followUpA;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSearchText).toHaveBeenCalledTimes(1);
    expect(mockSearchImages).toHaveBeenCalledTimes(1);
  });

  it("drops a late follow-up page read after a newer follow-up completes on the same run", async () => {
    let releasePageReadA: (contents: Record<string, string>) => void = () => {};
    mockSearchText.mockResolvedValueOnce({
      results: [["Shared", "snippet", "https://shared.example"]],
      stale: false,
    });
    mockFetchPageContents.mockReturnValueOnce(
      new Promise((resolve) => {
        releasePageReadA = resolve;
      }),
    );

    const followUpA = runFollowUpSearch(
      [{ role: "user", content: "first" }],
      "first",
      makeSettings({ enableImageSearch: false }),
      [],
      [],
    );
    await vi.waitFor(() =>
      expect(mockFetchPageContents).toHaveBeenCalledTimes(1),
    );

    mockSearchText.mockResolvedValueOnce({
      results: [["Shared", "snippet", "https://shared.example"]],
      stale: false,
    });
    mockFetchPageContents.mockResolvedValueOnce({
      "https://shared.example": "B excerpt",
    });
    await runFollowUpSearch(
      [{ role: "user", content: "second" }],
      "second",
      makeSettings({ enableImageSearch: false }),
      [],
      [],
    );

    releasePageReadA({ "https://shared.example": "A stale excerpt" });
    await followUpA;

    expect(mockUpdatePageContents).toHaveBeenCalledTimes(1);
    expect(mockUpdatePageContents).toHaveBeenCalledWith({
      "https://shared.example": "B excerpt",
    });
  });
});
