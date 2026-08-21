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
  updateImageSearchResults: vi.fn(),
  updateLlmTextSearchResults: vi.fn(),
  updateTextSearchResults: vi.fn(),
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
import {
  updateImageSearchResults,
  updateLlmTextSearchResults,
  updateTextSearchResults,
} from "./pubSub";
import { searchImages, searchText } from "./search";
import type { ImageSearchResults, TextSearchResults } from "./types";

const mockSearchText = vi.mocked(searchText);
const mockSearchImages = vi.mocked(searchImages);
const mockSaveChat = vi.mocked(saveChatMessageForQuery);
const mockUpdateText = vi.mocked(updateTextSearchResults);
const mockUpdateImage = vi.mocked(updateImageSearchResults);
const mockUpdateLlmText = vi.mocked(updateLlmTextSearchResults);

describe("refreshTextSearchResults", () => {
  it("deduplicates by URL and appends fresh results", async () => {
    const existing: TextSearchResults = [
      ["Existing", "snippet", "https://existing.com"],
    ];
    const fresh: TextSearchResults = [
      ["New", "snippet", "https://new.com"],
      ["Duplicate", "snippet", "https://existing.com"],
    ];

    mockSearchText.mockResolvedValueOnce(fresh);

    await refreshTextSearchResults("query", 10, existing);

    expect(mockUpdateText).toHaveBeenCalledWith([
      ["Existing", "snippet", "https://existing.com"],
      ["New", "snippet", "https://new.com"],
    ]);
  });

  it("skips updates when all fresh results are duplicates", async () => {
    const existing: TextSearchResults = [
      ["Title", "snippet", "https://dup.com"],
    ];
    const fresh: TextSearchResults = [["Title", "snippet", "https://dup.com"]];

    mockSearchText.mockResolvedValueOnce(fresh);

    await refreshTextSearchResults("query", 10, existing);

    expect(mockUpdateText).not.toHaveBeenCalled();
  });

  it("skips updates when there are no fresh results", async () => {
    mockSearchText.mockResolvedValueOnce([]);

    await refreshTextSearchResults("query", 10, []);

    expect(mockUpdateText).not.toHaveBeenCalled();
    // An empty refresh must not blank what the model was given either.
    expect(mockUpdateLlmText).not.toHaveBeenCalled();
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

    mockSearchImages.mockResolvedValueOnce(fresh);

    await refreshImageSearchResults("query", 10, existing);

    expect(mockUpdateImage).toHaveBeenCalledWith([
      ["New", "https://new.com", "thumb", "source"],
      ["Existing", "https://existing.com", "thumb", "source"],
    ]);
  });

  it("skips updates when there are no fresh results", async () => {
    mockSearchImages.mockResolvedValueOnce([]);

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
      searchResultsLimit: 10,
      ...overrides,
    }) as unknown as Parameters<typeof runFollowUpSearch>[2];

  it("refreshes text results when enabled", async () => {
    mockSearchText.mockResolvedValueOnce([
      ["Title", "snippet", "https://new.com"],
    ]);

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
