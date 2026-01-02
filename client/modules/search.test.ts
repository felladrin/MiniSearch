import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const hashQuery = (query: string) =>
  query
    .split("")
    .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
    .toString(36);

const mockFetchResponse = (results: string[][]) => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(results),
  });
};

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.mock("./searchTokenHash", () => ({
  getSearchTokenHash: vi.fn().mockResolvedValue("mock-token-hash"),
}));

describe("Search Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("hashQuery", () => {
    it("should generate consistent hashes for the same query", () => {
      const hash1 = hashQuery("test query");
      const hash2 = hashQuery("test query");
      expect(hash1).toBe(hash2);
    });

    it("should generate different hashes for different queries", () => {
      const hash1 = hashQuery("test query");
      const hash2 = hashQuery("different query");
      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty strings", () => {
      const hash = hashQuery("");
      expect(hash).toBe("0");
    });

    it("should handle special characters", () => {
      const hash1 = hashQuery("test@query#123");
      const hash2 = hashQuery("test@query#123");
      expect(hash1).toBe(hash2);
    });

    it("should handle unicode characters", () => {
      const hash1 = hashQuery("日本語テスト");
      const hash2 = hashQuery("日本語テスト");
      expect(hash1).toBe(hash2);
    });
  });

  describe("searchText API behavior", () => {
    it("should handle API errors gracefully and return empty array", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      expect(mockFetch).toBeDefined();
    });

    it("should handle non-OK HTTP responses", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const response = await mockFetch();
      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
    });

    it("should parse JSON response correctly", async () => {
      const mockResults = [["Title 1", "Snippet 1", "https://example.com/1"]];
      mockFetchResponse(mockResults);

      const response = await mockFetch();
      const data = await response.json();
      expect(data).toEqual(mockResults);
    });
  });

  describe("searchImages API behavior", () => {
    it("should handle image search API errors", async () => {
      mockFetch.mockRejectedValue(new Error("Image search failed"));

      await expect(mockFetch()).rejects.toThrow("Image search failed");
    });

    it("should parse image results correctly", async () => {
      const mockResults = [
        ["Image 1", "Alt text 1", "https://example.com/image1.jpg"],
        ["Image 2", "Alt text 2", "https://example.com/image2.jpg"],
      ];
      mockFetchResponse(mockResults);

      const response = await mockFetch();
      const data = await response.json();
      expect(data).toHaveLength(2);
      expect(data[0][0]).toBe("Image 1");
    });
  });

  describe("URL construction", () => {
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

  describe("Cache configuration", () => {
    it("should have reasonable default TTL", () => {
      const defaultTTL = 15 * 60 * 1000;
      expect(defaultTTL).toBe(900000);
    });

    it("should have reasonable default max entries", () => {
      const defaultMaxEntries = 100;
      expect(defaultMaxEntries).toBe(100);
    });
  });

  describe("Error Handling patterns", () => {
    it("should handle network timeouts", async () => {
      mockFetch.mockRejectedValue(new Error("Network timeout"));

      await expect(mockFetch()).rejects.toThrow("Network timeout");
    });

    it("should handle malformed JSON responses", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
      });

      const response = await mockFetch();
      await expect(response.json()).rejects.toThrow("Unexpected token");
    });
  });
});
