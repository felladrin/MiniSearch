import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "./logEntries";
import * as searchModule from "./search";

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.mock("./searchTokenHash", () => ({
  getSearchTokenHash: vi.fn().mockResolvedValue("mock-token-hash"),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.stubGlobal("self", {
  location: new URL("http://localhost:3000"),
});

const mockFetchResponse = (results: string[][]) => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(results),
  });
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
    // Clear the fake IndexedDB database so each test starts fresh.
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
      ).resolves.toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Each row has to reach the branch it is named for. The three tests these
    // replaced did not: one asserted `response.json()` on the fetch mock
    // without ever calling `performSearch`, and the other two rejected with a
    // plain Error, which matches neither `AbortError` nor the lowercase
    // "network" the wrapper looks for, so both only watched a raw error
    // propagate.
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
        "labels a network failure",
        () => mockFetch.mockRejectedValue(new Error("network is unreachable")),
        "Network error: network is unreachable",
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
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResults),
      });

      // First call — cache miss, fetches from network.
      const firstResults = await searchModule.searchText("cached query");
      expect(firstResults).toEqual(mockResults);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call with the same query — should be a cache hit.
      const secondResults = await searchModule.searchText("cached query");
      expect(secondResults).toEqual(mockResults);
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
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResults),
      });

      const firstResults = await searchModule.searchImages("cached images");
      expect(firstResults).toEqual(mockResults);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const secondResults = await searchModule.searchImages("cached images");
      expect(secondResults).toEqual(mockResults);
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
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResults),
      });

      await searchModule.searchText("query A");
      await searchModule.searchText("query B");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should treat different limits as separate cache entries", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResults),
      });

      await searchModule.searchText("same query", 5);
      await searchModule.searchText("same query", 10);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should refetch when TTL expires", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResults),
      });

      await searchModule.searchText("ttl query");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Expire the cache entry instantly.
      searchModule.searchServiceInstance.updateCacheConfig({ ttl: 0 });

      const secondResults = await searchModule.searchText("ttl query");
      expect(secondResults).toEqual(mockResults);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should skip cache when caching is disabled", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResults),
      });

      searchModule.searchServiceInstance.updateCacheConfig({ enabled: false });

      await searchModule.searchText("disabled cache query");
      await searchModule.searchText("disabled cache query");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should use separate caches for text and image stores", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResults),
      });

      await searchModule.searchText("cross-store query");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await searchModule.searchImages("cross-store query");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Repeat the image query — should hit the image cache, not the network.
      await searchModule.searchImages("cross-store query");
      expect(mockFetch).toHaveBeenCalledTimes(2);
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
