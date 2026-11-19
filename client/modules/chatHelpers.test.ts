import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.clearAllMocks());

vi.mock("./search", () => ({
  searchText: vi.fn(),
  searchImages: vi.fn(),
}));
vi.mock("./history", () => ({
  getCurrentSearchRunId: vi.fn(() => "run-1"),
  saveChatMessageForQuery: vi.fn(() => Promise.resolve()),
  updateSearchResults: vi.fn(() => Promise.resolve()),
}));
vi.mock("./pubSub", () => ({
  getPageContents: vi.fn(() => ({})),
  updateImageSearchResults: vi.fn(),
  updateLlmTextSearchResults: vi.fn(),
  updatePageContents: vi.fn(),
  updateTextSearchResults: vi.fn(),
  updateTextSearchStale: vi.fn(),
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
  persistChatMessages,
  refreshImageSearchResults,
  refreshTextSearchResults,
  runFollowUpSearch,
} from "./chatHelpers";
import { saveChatMessageForQuery } from "./history";
import { fetchPageContents } from "./pageContent";
import {
  getPageContents,
  updateImageSearchResults,
  updateLlmTextSearchResults,
  updatePageContents,
  updateTextSearchResults,
  updateTextSearchStale,
} from "./pubSub";
import { searchImages, searchText } from "./search";
import type { ImageSearchResults, TextSearchResults } from "./types";

const mockSearchText = vi.mocked(searchText);
const mockSearchImages = vi.mocked(searchImages);
const mockSaveChat = vi.mocked(saveChatMessageForQuery);
const mockUpdateText = vi.mocked(updateTextSearchResults);
const mockUpdateImage = vi.mocked(updateImageSearchResults);
const mockUpdateLlmText = vi.mocked(updateLlmTextSearchResults);
const mockUpdateTextStale = vi.mocked(updateTextSearchStale);
const mockFetchPageContents = vi.mocked(fetchPageContents);
const mockGetPageContents = vi.mocked(getPageContents);
const mockUpdatePageContents = vi.mocked(updatePageContents);

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
});

describe("refreshImageSearchResults", () => {
  it("deduplicates by URL and prepends fresh results", async () => {
    const existing: ImageSearchResults = [
      ["Existing", "https://existing.com", "thumb", "source"],
    ];
    const fresh: ImageSearchResults = [
      ["New", "https://new.com", "thumb", "source"],
      ["Duplicate", "https://existing.com", "thumb", "source"],
    ];

    mockSearchImages.mockResolvedValueOnce({ results: fresh, stale: false });

    await refreshImageSearchResults("query", 10, existing);

    expect(mockUpdateImage).toHaveBeenCalledWith([
      ["New", "https://new.com", "thumb", "source"],
      ["Existing", "https://existing.com", "thumb", "source"],
    ]);
  });

  it("skips updates when there are no fresh results", async () => {
    mockSearchImages.mockResolvedValueOnce({ results: [], stale: false });

    await refreshImageSearchResults("query", 10, []);

    expect(mockUpdateImage).not.toHaveBeenCalled();
  });
});

describe("persistChatMessages", () => {
  it("saves user and assistant messages", async () => {
    await persistChatMessages("my query", "user msg", "assistant msg");

    expect(mockSaveChat).toHaveBeenCalledWith("my query", "user", "user msg");
    expect(mockSaveChat).toHaveBeenCalledWith(
      "my query",
      "assistant",
      "assistant msg",
    );
  });
});

describe("runFollowUpSearch", () => {
  const makeSettings = (overrides = {}) =>
    ({
      enableTextSearch: true,
      enableImageSearch: true,
      enablePageContentFetch: true,
      searchResultsLimit: 10,
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
