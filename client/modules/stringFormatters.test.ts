import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  getHostname,
  getSemanticVersion,
  groupSearchResultsByDate,
  searchWithFuzzy,
} from "./stringFormatters";

describe("stringFormatters", () => {
  describe("getHostname", () => {
    it("should extract hostname from valid URL", () => {
      expect(getHostname("https://example.com/page")).toBe("example.com");
    });

    it("should remove www prefix", () => {
      expect(getHostname("https://www.example.com/page")).toBe("example.com");
    });

    it("should handle http URLs", () => {
      expect(getHostname("http://test.org/path")).toBe("test.org");
    });

    it("should return original string for invalid URL", () => {
      expect(getHostname("not-a-url")).toBe("not-a-url");
    });

    it("should handle URL with port (hostname only)", () => {
      expect(getHostname("https://localhost:3000")).toBe("localhost");
    });
  });

  describe("getSemanticVersion", () => {
    it("should convert number timestamp to YYYY.MM.DD format", () => {
      const result = getSemanticVersion(1700000000000);
      expect(result).toMatch(/^\d{4}\.\d{1,2}\.\d{1,2}$/);
    });

    it("should handle Date object", () => {
      const result = getSemanticVersion(new Date(2024, 0, 15));
      expect(result).toBe("2024.1.15");
    });

    it("should handle ISO date string", () => {
      const result = getSemanticVersion("2024-06-01");
      expect(result).toMatch(/^2024\.6\.1$/);
    });
  });

  describe("formatRelativeTime", () => {
    it("should return Just now for recent timestamp", () => {
      const now = Date.now();
      expect(formatRelativeTime(now)).toBe("Just now");
    });

    it("should return minutes ago", () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      expect(formatRelativeTime(fiveMinutesAgo)).toBe("5m ago");
    });

    it("should return hours ago", () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
    });

    it("should return days ago", () => {
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      expect(formatRelativeTime(threeDaysAgo)).toBe("3d ago");
    });

    it("should return locale date for older timestamps", () => {
      const oldTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const result = formatRelativeTime(oldTimestamp);
      expect(result).not.toContain("ago");
    });
  });

  describe("searchWithFuzzy", () => {
    const items = [
      { id: 1, name: "apple" },
      { id: 2, name: "application" },
      { id: 3, name: "banana" },
      { id: 4, name: "blueprint" },
    ];

    it("should return all items with score 0 for empty query", () => {
      const results = searchWithFuzzy(items, "", (item) => item.name);
      expect(results).toHaveLength(4);
      expect(results.every((r) => r.score === 0)).toBe(true);
    });

    it("should find matches with fuzzy search", () => {
      const results = searchWithFuzzy(items, "app", (item) => item.name);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.name).toContain("app");
    });

    it("should respect limit parameter", () => {
      const results = searchWithFuzzy(items, "a", (item) => item.name, 2);
      expect(results).toHaveLength(2);
    });

    it("should return empty array for no matches", () => {
      const results = searchWithFuzzy(items, "xyz", (item) => item.name);
      expect(results).toHaveLength(0);
    });

    it("should return scores between 0 and 1", () => {
      const results = searchWithFuzzy(items, "a", (item) => item.name);
      results.forEach((r) => {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      });
    });
  });

  describe("groupSearchResultsByDate", () => {
    it("should group items by Today", () => {
      const now = Date.now();
      const items = [{ item: { id: 1 }, timestamp: now }];
      const groups = groupSearchResultsByDate(items);
      expect(groups.Today).toHaveLength(1);
    });

    it("should group items by Yesterday", () => {
      const yesterday = Date.now() - 24 * 60 * 60 * 1000;
      const items = [{ item: { id: 1 }, timestamp: yesterday }];
      const groups = groupSearchResultsByDate(items);
      expect(groups.Yesterday).toHaveLength(1);
    });

    it("should group items by This Week", () => {
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const items = [{ item: { id: 1 }, timestamp: threeDaysAgo }];
      const groups = groupSearchResultsByDate(items);
      expect(groups["This Week"]).toHaveLength(1);
    });

    it("should group older items by month", () => {
      const oldTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const items = [{ item: { id: 1 }, timestamp: oldTimestamp }];
      const groups = groupSearchResultsByDate(items);
      const keys = Object.keys(groups);
      expect(keys.length).toBe(1);
      expect(keys[0]).toMatch(/^\w{3} \d{4}$/);
    });

    it("should handle empty array", () => {
      const groups = groupSearchResultsByDate([]);
      expect(Object.keys(groups)).toHaveLength(0);
    });

    it("should group multiple items in same category", () => {
      const now = Date.now();
      const items = [
        { item: { id: 1 }, timestamp: now },
        { item: { id: 2 }, timestamp: now - 60 * 1000 },
      ];
      const groups = groupSearchResultsByDate(items);
      expect(groups.Today).toHaveLength(2);
    });
  });
});
