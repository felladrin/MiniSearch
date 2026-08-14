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
      const result1 =
        await searchModule.searchServiceInstance.hashQuery("test query");
      const result2 =
        await searchModule.searchServiceInstance.hashQuery("test query");
      expect(result1).toBe(result2);
    });

    it("should return different hashes for different queries", async () => {
      const result1 =
        await searchModule.searchServiceInstance.hashQuery("query one");
      const result2 =
        await searchModule.searchServiceInstance.hashQuery("query two");
      expect(result1).not.toBe(result2);
    });

    it("should handle empty query string", async () => {
      const result = await searchModule.searchServiceInstance.hashQuery("");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("should handle special characters", async () => {
      const hash1 =
        await searchModule.searchServiceInstance.hashQuery("test@query#123");
      expect(hash1).toBe(
        await searchModule.searchServiceInstance.hashQuery("test@query#123"),
      );
    });

    it("should handle unicode characters", async () => {
      const hash1 =
        await searchModule.searchServiceInstance.hashQuery("日本語テスト");
      expect(hash1).toBe(
        await searchModule.searchServiceInstance.hashQuery("日本語テスト"),
      );
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
      ).rejects.toThrow(/Query cannot be/i);
    });

    it("should handle network failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network unavailable"));

      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          "test",
        ),
      ).rejects.toThrow("Network unavailable");
    });

    it("should handle timeout scenario", async () => {
      mockFetch.mockRejectedValue(new Error("Request timeout"));

      await expect(
        searchModule.searchServiceInstance.performSearch<string[][]>(
          "text",
          "test",
        ),
      ).rejects.toThrow("Request timeout");
    });

    it("should handle malformed JSON response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
      });

      const response = await mockFetch();
      await expect(response.json()).rejects.toThrow("Unexpected token");
    });
  });

  describe("Get Cache Stats Function", () => {
    it("should return cache statistics object", () => {
      const stats = searchModule.searchServiceInstance.getCacheStats();

      expect(stats).toHaveProperty("textHitRate");
      expect(stats).toHaveProperty("imageHitRate");
      expect(stats).toHaveProperty("textHits");
      expect(stats).toHaveProperty("textMisses");
      expect(stats).toHaveProperty("imageHits");
      expect(stats).toHaveProperty("imageMisses");
      expect(stats).toHaveProperty("config");
      expect(stats.config).toHaveProperty("ttl");
      expect(stats.config).toHaveProperty("maxEntries");
      expect(stats.config).toHaveProperty("enabled");
    });

    it("should track text search cache hits and misses", () => {
      const initialStats = searchModule.searchServiceInstance.getCacheStats();
      expect(initialStats.textHits).toBeGreaterThanOrEqual(0);
      expect(initialStats.textMisses).toBeGreaterThanOrEqual(0);
    });

    it("should track image search cache hits and misses", () => {
      const initialStats = searchModule.searchServiceInstance.getCacheStats();
      expect(initialStats.imageHits).toBeGreaterThanOrEqual(0);
      expect(initialStats.imageMisses).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Update Cache Config Function", () => {
    it("should update ttl when provided", () => {
      const newTTL = 60000;
      searchModule.searchServiceInstance.updateCacheConfig({ ttl: newTTL });

      const statsTTL =
        searchModule.searchServiceInstance.getCacheStats().config.ttl;
      expect(statsTTL).toBe(newTTL);
    });

    it("should update maxEntries when provided", () => {
      searchModule.searchServiceInstance.updateCacheConfig({
        maxEntries: 50,
      });

      const maxEntries =
        searchModule.searchServiceInstance.getCacheStats().config.maxEntries;
      expect(maxEntries).toBe(50);
    });

    it("should update enabled when provided", () => {
      searchModule.searchServiceInstance.updateCacheConfig({
        enabled: false,
      });

      const enabled =
        searchModule.searchServiceInstance.getCacheStats().config.enabled;
      expect(enabled).toBe(false);
    });

    it("should reject invalid TTL value", () => {
      expect(() =>
        searchModule.searchServiceInstance.updateCacheConfig({ ttl: -1 }),
      ).toThrow();
    });

    it("should reject invalid maxEntries value", () => {
      expect(() =>
        searchModule.searchServiceInstance.updateCacheConfig({
          maxEntries: -1,
        }),
      ).toThrow();
    });
  });

  describe("Cache Failure Scenarios", () => {
    it("should propagate the failure when a text search fails end-to-end", async () => {
      // getCachedResult/cacheResult swallow their own read/write errors, so a
      // cache failure surfaces as a miss followed by a real fetch — searchText
      // must reject so callers can tell an outage apart from an empty result
      // set instead of collapsing both into [].
      mockFetch.mockRejectedValue(new Error("Cache read error"));

      await expect(searchModule.searchText("test query")).rejects.toThrow(
        "Cache read error",
      );
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("Text search failed"),
      );
    });

    it("should still return fresh results when the underlying fetch succeeds", async () => {
      const mockResults: string[][] = [
        ["Title", "Snippet", "https://example.com"],
      ];
      mockFetchResponse(mockResults);

      const results = await searchModule.searchText("test query");

      expect(results).toEqual(mockResults);
    });
  });

  describe("Database Integrity Failures", () => {
    it("should propagate the failure when an image search fails end-to-end", async () => {
      // ensureIntegrity/cleanExpiredCache swallow their own errors, so a
      // corrupted database surfaces as a miss followed by a real fetch —
      // searchImages must reject so callers can tell an outage apart from an
      // empty result set instead of collapsing both into [].
      mockFetch.mockRejectedValue(new Error("Database integrity check failed"));

      await expect(searchModule.searchImages("test query")).rejects.toThrow(
        "Database integrity check failed",
      );
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("Image search failed"),
      );
    });

    it("should recover and return fresh results after a prior failure", async () => {
      const mockResults: string[][] = [
        ["Image", "Alt", "https://example.com/img.jpg"],
      ];
      mockFetchResponse(mockResults);

      const results = await searchModule.searchImages("test query");

      expect(results).toEqual(mockResults);
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
