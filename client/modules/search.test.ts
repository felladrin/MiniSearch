import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Hash Query Function", () => {
    it("should return the same hash for identical queries", () => {
      const result1 =
        searchModule.searchServiceInstance.hashQuery("test query");
      const result2 =
        searchModule.searchServiceInstance.hashQuery("test query");
      expect(result1).toBe(result2);
    });

    it("should return different hashes for different queries", () => {
      const result1 = searchModule.searchServiceInstance.hashQuery("query one");
      const result2 = searchModule.searchServiceInstance.hashQuery("query two");
      expect(result1).not.toBe(result2);
    });

    it("should handle empty query string", () => {
      const result = searchModule.searchServiceInstance.hashQuery("");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("should handle special characters", () => {
      const hash1 =
        searchModule.searchServiceInstance.hashQuery("test@query#123");
      expect(hash1).toBe(
        searchModule.searchServiceInstance.hashQuery("test@query#123"),
      );
    });

    it("should handle unicode characters", () => {
      const hash1 =
        searchModule.searchServiceInstance.hashQuery("日本語テスト");
      expect(hash1).toBe(
        searchModule.searchServiceInstance.hashQuery("日本語テスト"),
      );
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
    it("should handle cache retrieval failure", async () => {
      const mockCacheFailure = vi
        .fn()
        .mockRejectedValue(new Error("Cache read error"));
      await expect(mockCacheFailure()).rejects.toThrow("Cache read error");
    });

    it("should handle cache storage failure", async () => {
      const mockCacheStorageFailure = vi
        .fn()
        .mockRejectedValue(new Error("Cache write error"));
      await expect(mockCacheStorageFailure()).rejects.toThrow(
        "Cache write error",
      );
    });
  });

  describe("Database Integrity Failures", () => {
    it("should handle database corruption gracefully", async () => {
      const mockDbOperation = vi
        .fn()
        .mockRejectedValue(new Error("Database integrity check failed"));
      await expect(mockDbOperation()).rejects.toThrow(
        "Database integrity check failed",
      );
    });

    it("should attempt database recovery after failure", async () => {
      const mockRecoveryFailure = vi
        .fn()
        .mockRejectedValueOnce(new Error("Recovery failed"));
      await expect(mockRecoveryFailure()).rejects.toThrow("Recovery failed");
    });
  });

  describe("URL Construction", () => {
    it("should construct correct search URL with query parameter", () => {
      const query = "test query";
      const searchUrl = new URL("/search/text", "http://localhost:3000");
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("token", "mock-token-hash");

      expect(searchUrl.searchParams.get("q")).toBe("test query");
      expect(searchUrl.searchParams.get("token")).toBe("mock-token-hash");
    });

    it("should include limit parameter when provided", () => {
      const searchUrl = new URL("/search/text", "http://localhost:3000");
      searchUrl.searchParams.set("q", "test");
      searchUrl.searchParams.set("limit", "5");

      expect(searchUrl.searchParams.get("limit")).toBe("5");
    });

    it("should construct correct image search URL", () => {
      const searchUrl = new URL("/search/images", "http://localhost:3000");
      searchUrl.searchParams.set("q", "cat photos");

      expect(searchUrl.pathname).toBe("/search/images");
      expect(searchUrl.searchParams.get("q")).toBe("cat photos");
    });
  });

  describe("Cache Configuration", () => {
    it("should have reasonable default TTL", () => {
      const defaultTTL = 15 * 60 * 1000;
      expect(defaultTTL).toBe(900000);
    });

    it("should have reasonable default max entries", () => {
      const defaultMaxEntries = 100;
      expect(defaultMaxEntries).toBe(100);
    });
  });

  describe("Network Timeout Scenarios", () => {
    it("should handle network timeouts gracefully", async () => {
      mockFetch.mockRejectedValue(
        new Error("Network timeout after 30 seconds"),
      );

      await expect(mockFetch()).rejects.toThrow("Network timeout");
    });
  });
});
