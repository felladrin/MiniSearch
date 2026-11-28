import type { SearchTimeRange } from "@shared/searchTimeRange";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateConfig } from "./config";
import { addLogEntry } from "./logEntries";
import * as searchModule from "./search";
import { getSearchTokenHash } from "./searchTokenHash";

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.mock("./config", () => ({
  invalidateConfig: vi.fn(),
}));

vi.mock("./searchTokenHash", () => ({
  getSearchTokenHash: vi.fn().mockResolvedValue("mock-token-hash"),
}));

const mockFetch = vi.fn();

/**
 * A search response, carrying the `headers` a real `Response` always has: the
 * module reads one of them to tell an answer that carries no time filter from
 * one that does.
 */
function searchResponse(
  results: string[][],
  headers: Record<string, string> = {},
) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(results),
    headers: { get: (name: string) => headers[name] ?? null },
  };
}

/** Answers every following `/search` fetch with `results`. */
function mockSearchResponse(
  results: string[][],
  headers?: Record<string, string>,
) {
  mockFetch.mockResolvedValue(searchResponse(results, headers));
}
vi.stubGlobal("fetch", mockFetch);
vi.stubGlobal("self", {
  location: new URL("http://localhost:3000"),
});

const mockFetchResponse = (
  results: string[][],
  headers?: Record<string, string>,
) => {
  mockFetch.mockResolvedValue(searchResponse(results, headers));
};

describe("Search Module", () => {
  beforeEach(async () => {
    // Reset shared mutable state mutated by other test suites so every
    // describe block runs with a clean, deterministic cache config.
    searchModule.searchServiceInstance.updateCacheConfig({
      ttl: 15 * 60 * 1000,
      maxEntries: 100,
      enabled: true,
    });
    await searchModule.searchServiceInstance.clearSearchCache();
    // Clear mocks after clearSearchCache so addLogEntry starts empty.
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Hash Query Function", () => {
    it("should return the same hash for identical queries", async () => {
      for (const query of [
        "test query",
        "",
        "test@query#123",
        "日本語テスト",
      ]) {
        const { hashQuery } = searchModule.searchServiceInstance;
        expect(await hashQuery(query)).toBe(await hashQuery(query));
      }
    });

    it("should return different hashes for different queries", async () => {
      const result1 =
        await searchModule.searchServiceInstance.hashQuery("query one");
      const result2 =
        await searchModule.searchServiceInstance.hashQuery("query two");
      expect(result1).not.toBe(result2);
    });

    it("should include limit in the hash so different limits produce different keys", async () => {
      const hashNoLimit =
        await searchModule.searchServiceInstance.hashQuery("test query");
      const hashLimit10 = await searchModule.searchServiceInstance.hashQuery(
        "test query",
        10,
      );
      const hashLimit20 = await searchModule.searchServiceInstance.hashQuery(
        "test query",
        20,
      );
      expect(hashNoLimit).not.toBe(hashLimit10);
      expect(hashLimit10).not.toBe(hashLimit20);
      expect(hashNoLimit).not.toBe(hashLimit20);
    });

    it("should treat an omitted limit the same as an explicit undefined", async () => {
      const hashOmitted =
        await searchModule.searchServiceInstance.hashQuery("test query");
      const hashUndefined = await searchModule.searchServiceInstance.hashQuery(
        "test query",
        undefined,
      );
      expect(hashOmitted).toBe(hashUndefined);
    });

    it("should include the time range in the hash so different periods produce different keys", async () => {
      const { hashQuery } = searchModule.searchServiceInstance;
      const hashes = await Promise.all(
        ["any", "day", "week", "month", "year"].map((timeRange) =>
          hashQuery("test query", 10, timeRange as SearchTimeRange),
        ),
      );
      expect(new Set(hashes).size).toBe(5);
    });

    it("should keep an Anytime key the one it was before the filter existed", async () => {
      const { hashQuery } = searchModule.searchServiceInstance;
      // Anytime adds nothing to the hashed input, so the entries cached before
      // the setting existed are still the ones an Anytime search reads.
      expect(await hashQuery("test query", 10, "any")).toBe(
        await hashQuery("test query", 10),
      );
      expect(await hashQuery("test query", 10, undefined)).toBe(
        await hashQuery("test query", 10),
      );
    });

    it("should include the language in the hash so different languages produce different keys", async () => {
      const { hashQuery } = searchModule.searchServiceInstance;
      const hashes = await Promise.all(
        ["pt-BR", "en-US", "de", "all"].map((language) =>
          hashQuery("test query", 10, undefined, language),
        ),
      );
      expect(new Set(hashes).size).toBe(4);
    });

    it("should keep the key of a search that sends no language the one it was before the setting existed", async () => {
      const { hashQuery } = searchModule.searchServiceInstance;
      // No language adds nothing to the hashed input, so the entries cached
      // before the setting existed are still the ones such a search reads.
      expect(await hashQuery("test query", 10, undefined, undefined)).toBe(
        await hashQuery("test query", 10),
      );
    });

    it("should return a deterministic hex string of fixed length", async () => {
      const hash =
        await searchModule.searchServiceInstance.hashQuery("any query");
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe("Perform Search Function", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockFetch.mockReset();
    });

    it("should fetch from correct endpoint for text search", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockFetchResponse(mockResults);

      await searchModule.searchServiceInstance.performSearch<string[][]>(
        "text",
        "test query",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/search/text");
      expect(calledUrl).toContain("q=test+query");
    });

    it("should fetch from correct endpoint for images search", async () => {
      const mockResults: string[][] = [
        ["Image", "Alt", "https://example.com/img.jpg"],
      ];
      mockFetchResponse(mockResults);

      await searchModule.searchServiceInstance.performSearch<string[][]>(
        "images",
        "cats",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/search/images");
      expect(calledUrl).toContain("q=cats");
    });

    it("should include limit parameter when provided", async () => {
      mockFetchResponse([]);

      await searchModule.searchServiceInstance.performSearch<string[][]>(
        "text",
        "test",
        10,
      );

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("limit=10");
    });

    it("should send the time range as a query parameter", async () => {
      mockFetchResponse([]);

      await searchModule.searchServiceInstance.performSearch<string[][]>(
        "text",
        "test",
        10,
        "week",
      );

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("time_range=week");
    });

    it("should send no time range for Anytime", async () => {
      mockFetchResponse([]);

      await searchModule.searchServiceInstance.performSearch<string[][]>(
        "text",
        "test",
        10,
        "any",
      );

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain("time_range");
    });

    it("should send a chosen locale as the language parameter", async () => {
      mockFetchResponse([]);

      await searchModule.searchServiceInstance.performSearch<string[][]>(
        "text",
        "test",
        10,
        undefined,
        "pt-BR",
      );

      expect(mockFetch.mock.calls[0][0] as string).toContain("language=pt-BR");
    });

    it("should send all for Any language", async () => {
      mockFetchResponse([]);

      await searchModule.searchServiceInstance.performSearch<string[][]>(
        "text",
        "test",
        10,
        undefined,
        "all",
      );

      expect(mockFetch.mock.calls[0][0] as string).toContain("language=all");
    });

    it("should send the browser's own locale for Browser language", async () => {
      const browserLanguage = vi
        .spyOn(Navigator.prototype, "language", "get")
        .mockReturnValue("pt-BR");
      mockFetchResponse([]);

      await searchModule.searchText(
        "browser locale query",
        10,
        undefined,
        "browser",
      );

      // Resolved at search time, so the server gets a locale it can act on
      // rather than the guess it would have had to make from the query.
      expect(mockFetch.mock.calls[0][0] as string).toContain("language=pt-BR");
      browserLanguage.mockRestore();
    });

    it("should send no language when the search has none", async () => {
      mockFetchResponse([]);

      await searchModule.searchServiceInstance.performSearch<string[][]>(
        "text",
        "test",
        10,
      );

      expect(mockFetch.mock.calls[0][0] as string).not.toContain("language=");
    });

    it("should throw on non-OK response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          "test",
        ),
      ).rejects.toThrow("HTTP error! status: 500");
    });

    it("should reject invalid endpoint type", async () => {
      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          // @ts-expect-error Invalid endpoint type
          "invalid",
          "test",
        ),
      ).rejects.toThrow("Invalid endpoint type");
    });

    it("should reject empty query", async () => {
      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          "",
        ),
      ).rejects.toThrow("Query cannot be empty");
    });

    it("should reject whitespace-only query", async () => {
      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          "   ",
        ),
      ).rejects.toThrow("Query cannot be empty");
    });

    it("should reject a query over the maximum length before fetching", async () => {
      const overLimit = "a".repeat(2001);

      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          overLimit,
        ),
      ).rejects.toThrow("Query length exceeds maximum of 2000 characters");
      // The guard fires before the request is built, so nothing is fetched.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should accept a query at exactly the maximum length", async () => {
      mockFetchResponse([]);

      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          "a".repeat(2000),
        ),
      ).resolves.toEqual({ results: [], timeFilterNotApplied: false });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Each row has to reach the branch it is named for. A network failure is a
    // TypeError in every browser, each with its own wording.
    it.each([
      [
        "wraps a body it cannot parse",
        () =>
          mockFetch.mockResolvedValue({
            ok: true,
            json: vi
              .fn()
              .mockRejectedValue(new SyntaxError("Unexpected token")),
          }),
        "JSON parsing error: Unexpected token",
      ],
      [
        "labels a Chrome network failure",
        () => mockFetch.mockRejectedValue(new TypeError("Failed to fetch")),
        "Network error: Failed to fetch",
      ],
      [
        "labels a Firefox network failure",
        () =>
          mockFetch.mockRejectedValue(
            new TypeError("NetworkError when attempting to fetch resource."),
          ),
        "Network error: NetworkError when attempting to fetch resource.",
      ],
      [
        "labels a Safari network failure",
        () => mockFetch.mockRejectedValue(new TypeError("Load failed")),
        "Network error: Load failed",
      ],
      [
        "labels an aborted request as a timeout",
        () =>
          mockFetch.mockRejectedValue(
            Object.assign(new Error("The operation was aborted"), {
              name: "AbortError",
            }),
          ),
        "Request timeout - server did not respond within 30 seconds",
      ],
    ])("%s", async (_, arrange, expected) => {
      arrange();

      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          "test",
        ),
      ).rejects.toThrow(expected);
    });

    it("labels a timeout that fires while the body is still arriving", async () => {
      // The headers came back in time, then the body stalled until the
      // request timer aborted it.
      mockFetch.mockImplementation(
        async (_url: string, init: { signal: AbortSignal }) => ({
          ok: true,
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener("abort", () =>
                reject(
                  new DOMException("The user aborted a request.", "AbortError"),
                ),
              );
            }),
        }),
      );
      vi.useFakeTimers();
      try {
        const search = searchModule.searchServiceInstance
          .performSearch<string[][]>("text", "test")
          .catch((caught: Error) => caught);
        await vi.advanceTimersByTimeAsync(30 * 1000);

        const error = await search;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
          "Request timeout - server did not respond within 30 seconds",
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // A restart, a second instance or a dev-server reload mints a new search
  // token, and a tab opened before that keeps hashing the old one. These pin
  // the recovery: the page takes the token the server is handing out now and
  // tries again, once.
  describe("Search Token Rotation", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockFetch.mockReset();
    });

    afterEach(() => {
      // The token mock is module-level, so the queued one-shot values have to
      // go back to the shared default for the describe blocks that follow.
      vi.mocked(getSearchTokenHash).mockReset();
      vi.mocked(getSearchTokenHash).mockResolvedValue("mock-token-hash");
    });

    it("refetches the config and retries once when the token is rejected", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      vi.mocked(getSearchTokenHash)
        .mockResolvedValueOnce("stale-token-hash")
        .mockResolvedValueOnce("fresh-token-hash");
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce(searchResponse(mockResults));

      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          "test query",
        ),
      ).resolves.toEqual({ results: mockResults, timeFilterNotApplied: false });

      expect(invalidateConfig).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0] as string).toContain(
        "token=stale-token-hash",
      );
      expect(mockFetch.mock.calls[1][0] as string).toContain(
        "token=fresh-token-hash",
      );
    });

    it("reports a second rejection instead of retrying again", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          "test query",
        ),
      ).rejects.toThrow("HTTP error! status: 401");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(invalidateConfig).toHaveBeenCalledTimes(1);
    });

    it("leaves the token alone when the request fails for another reason", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          "test query",
        ),
      ).rejects.toThrow("HTTP error! status: 500");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(invalidateConfig).not.toHaveBeenCalled();
    });
  });

  describe("Update Cache Config Function", () => {
    it.each([
      ["ttl", 60000],
      ["maxEntries", 50],
      ["enabled", false],
    ] as const)("should update %s when provided", (field, value) => {
      searchModule.searchServiceInstance.updateCacheConfig({ [field]: value });

      expect(
        searchModule.searchServiceInstance.getCacheStats().config[field],
      ).toBe(value);
    });

    it("should reject invalid TTL value", () => {
      expect(() =>
        searchModule.searchServiceInstance.updateCacheConfig({ ttl: -1 }),
      ).toThrow("Invalid TTL value: -1");
    });

    it("should reject invalid maxEntries value", () => {
      expect(() =>
        searchModule.searchServiceInstance.updateCacheConfig({
          maxEntries: -1,
        }),
      ).toThrow("Invalid maxEntries value: -1");
    });
  });

  describe("Search Failures", () => {
    // The cache layer swallows its own read, write and integrity errors, so a
    // failed search is always a failed fetch by the time it reaches the caller,
    // and it has to stay one so the caller can mark the search as failed.
    it("should rethrow when a text search fails end-to-end", async () => {
      mockFetch.mockRejectedValue(new Error("upstream refused the connection"));

      await expect(searchModule.searchText("test query")).rejects.toThrow(
        "upstream refused the connection",
      );
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("Text search failed"),
      );
    });

    it("should rethrow when an image search fails end-to-end", async () => {
      mockFetch.mockRejectedValue(new Error("upstream refused the connection"));

      await expect(searchModule.searchImages("test query")).rejects.toThrow(
        "upstream refused the connection",
      );
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("Image search failed"),
      );
    });
  });

  describe("Cache Hit Path", () => {
    it("should serve a repeated text query from the IndexedDB cache without a second fetch", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      const firstResults = await searchModule.searchText("cached query");
      expect(firstResults).toEqual({
        results: mockResults,
        stale: false,
        timeFilterNotApplied: false,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const secondResults = await searchModule.searchText("cached query");
      expect(secondResults).toEqual({
        results: mockResults,
        stale: false,
        timeFilterNotApplied: false,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("Text search: Reused 1 results from the cache"),
      );
      expect(searchModule.searchServiceInstance.getCacheStats().textHits).toBe(
        1,
      );
    });

    it("should serve a repeated image query from the IndexedDB cache without a second fetch", async () => {
      const mockResults: string[][] = [
        ["Image", "Alt", "https://example.com/img.jpg"],
      ];
      mockSearchResponse(mockResults);

      const firstResults = await searchModule.searchImages("cached images");
      expect(firstResults).toEqual({
        results: mockResults,
        stale: false,
        timeFilterNotApplied: false,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const secondResults = await searchModule.searchImages("cached images");
      expect(secondResults).toEqual({
        results: mockResults,
        stale: false,
        timeFilterNotApplied: false,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining(
          "Image search: Reused 1 results from the cache",
        ),
      );
      expect(searchModule.searchServiceInstance.getCacheStats().imageHits).toBe(
        1,
      );
    });

    it("should treat different queries as separate cache entries", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      await searchModule.searchText("query A");
      await searchModule.searchText("query B");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should treat different limits as separate cache entries", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      await searchModule.searchText("same query", 5);
      await searchModule.searchText("same query", 10);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should treat different time ranges as separate cache entries", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      await searchModule.searchText("same query", 5, "week");
      await searchModule.searchText("same query", 5, "month");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should read an Anytime search from the entry cached without a time range", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      await searchModule.searchText("anytime query", 5);
      await searchModule.searchText("anytime query", 5, "any");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should treat different languages as separate cache entries", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      await searchModule.searchText("same query", 5, undefined, "pt-BR");
      await searchModule.searchText("same query", 5, undefined, "en-US");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should read a search with no language from the entry cached before the setting existed", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      await searchModule.searchText("no language query", 5);
      await searchModule.searchText(
        "no language query",
        5,
        undefined,
        undefined,
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should refetch when TTL expires", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      await searchModule.searchText("ttl query");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      searchModule.searchServiceInstance.updateCacheConfig({ ttl: 0 });

      const secondResults = await searchModule.searchText("ttl query");
      expect(secondResults).toEqual({
        results: mockResults,
        stale: false,
        timeFilterNotApplied: false,
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should skip cache when caching is disabled", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      searchModule.searchServiceInstance.updateCacheConfig({ enabled: false });

      await searchModule.searchText("disabled cache query");
      await searchModule.searchText("disabled cache query");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should use separate caches for text and image stores", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      await searchModule.searchText("cross-store query");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await searchModule.searchImages("cross-store query");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      await searchModule.searchImages("cross-store query");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("Stale Result Fallback", () => {
    it("should serve stale cached results when a repeated query's live search fails", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      const first = await searchModule.searchText("stale query");
      expect(first).toEqual({
        results: mockResults,
        stale: false,
        timeFilterNotApplied: false,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      searchModule.searchServiceInstance.updateCacheConfig({ ttl: 0 });
      mockFetch.mockRejectedValue(new Error("upstream refused the connection"));

      const second = await searchModule.searchText("stale query");
      expect(second.results).toEqual(mockResults);
      expect(second.stale).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("from a previous search"),
      );
    });

    it("should still fail when the live search fails and nothing is cached to serve", async () => {
      mockFetch.mockRejectedValue(new Error("upstream refused the connection"));

      await expect(
        searchModule.searchText("never cached query"),
      ).rejects.toThrow("upstream refused the connection");
    });

    it("should not serve a cached entry past the stale retention even when the live search fails", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockSearchResponse(mockResults);

      try {
        // Cache an entry, then move past the 24-hour stale retention.
        await searchModule.searchText("aging query");
        vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
        mockFetch.mockRejectedValue(
          new Error("upstream refused the connection"),
        );

        await expect(searchModule.searchText("aging query")).rejects.toThrow(
          "upstream refused the connection",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    // The read-side recheck is the backup for a cleanup pass that failed;
    // pinning it alone would require reaching the internal database, which is
    // not exported, so this test pins the pair (cleanup plus recheck).
  });

  describe("Time Filter Not Applied", () => {
    const mockResults: string[][] = [
      ["Title", "Snippet", "https://example.com"],
    ];
    const notApplied = { "X-Search-Time-Range-Applied": "false" };

    it("should report the note when the server says the period was not applied", async () => {
      mockSearchResponse(mockResults, notApplied);

      const outcome = await searchModule.searchText(
        "fallback query",
        5,
        "week",
      );

      expect(outcome).toEqual({
        results: mockResults,
        stale: false,
        timeFilterNotApplied: true,
      });
    });

    it("should keep the note when those results come back from the cache", async () => {
      mockSearchResponse(mockResults, notApplied);
      await searchModule.searchText("cached fallback query", 5, "week");

      const cached = await searchModule.searchText(
        "cached fallback query",
        5,
        "week",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(cached.timeFilterNotApplied).toBe(true);
    });

    it("should not report the note when the server applied the period", async () => {
      mockSearchResponse(mockResults);

      const outcome = await searchModule.searchText(
        "filtered query",
        5,
        "week",
      );

      expect(outcome.timeFilterNotApplied).toBe(false);
    });
  });

  describe("Language Not Applied", () => {
    const mockResults: string[][] = [
      ["Title", "Snippet", "https://example.com"],
    ];
    const notApplied = { "X-Search-Language-Applied": "false" };

    it("should report the note when the server says the language was not applied", async () => {
      mockSearchResponse(mockResults, notApplied);

      const outcome = await searchModule.searchText(
        "fallback query",
        5,
        undefined,
        "pt-BR",
      );

      expect(outcome).toEqual({
        results: mockResults,
        stale: false,
        timeFilterNotApplied: false,
        languageNotApplied: true,
      });
    });

    it("should keep the note when those results come back from the cache", async () => {
      mockSearchResponse(mockResults, notApplied);
      await searchModule.searchText(
        "cached fallback query",
        5,
        undefined,
        "pt-BR",
      );

      const cached = await searchModule.searchText(
        "cached fallback query",
        5,
        undefined,
        "pt-BR",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(cached.languageNotApplied).toBe(true);
    });

    it("should not report the note when the server applied the language", async () => {
      mockSearchResponse(mockResults);

      const outcome = await searchModule.searchText(
        "filtered query",
        5,
        undefined,
        "pt-BR",
      );

      expect(outcome.languageNotApplied).toBeUndefined();
    });
  });

  describe("Unit Conversion", () => {
    const mockResults: string[][] = [
      ["Title", "Snippet", "https://example.com"],
    ];
    // Exactly what the server puts in the header: the answer, percent-encoded.
    const withConversion = { "X-Search-Unit-Conversion": "16.4041994751%20ft" };

    it("should read the conversion off the response header", async () => {
      mockSearchResponse(mockResults, withConversion);

      const outcome = await searchModule.searchText("5 m to ft", 5);

      expect(outcome).toEqual({
        results: mockResults,
        stale: false,
        timeFilterNotApplied: false,
        unitConversion: "16.4041994751 ft",
      });
    });

    it("should keep the conversion when those results come back from the cache", async () => {
      mockSearchResponse(mockResults, withConversion);
      await searchModule.searchText("cached conversion query", 5);

      const cached = await searchModule.searchText(
        "cached conversion query",
        5,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(cached.unitConversion).toBe("16.4041994751 ft");
    });

    it("should drop a header that does not decode and keep the results", async () => {
      // A lone percent sign is not a valid encoding.
      mockSearchResponse(mockResults, { "X-Search-Unit-Conversion": "100%" });

      const outcome = await searchModule.searchText("5 m to ft", 5);

      expect(outcome.results).toEqual(mockResults);
      expect(outcome.unitConversion).toBeUndefined();
    });

    it("should report no conversion when the header is absent", async () => {
      mockSearchResponse(mockResults);

      const outcome = await searchModule.searchText("plain query", 5);

      expect(outcome.unitConversion).toBeUndefined();
    });
  });

  describe("URL Construction", () => {
    it("should include the search token hash in the request URL", async () => {
      mockFetchResponse([]);

      await searchModule.searchServiceInstance.performSearch<string[][]>(
        "text",
        "test query",
      );

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("token=mock-token-hash");
    });

    it("should URL-encode special characters in the query", async () => {
      mockFetchResponse([]);

      await searchModule.searchServiceInstance.performSearch<string[][]>(
        "text",
        "cats & dogs",
      );

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("q=cats+%26+dogs");
    });
  });
});
