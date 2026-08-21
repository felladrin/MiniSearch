import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatRelativeTime,
  getHostname,
  getSemanticVersion,
  groupSearchResultsByDate,
  searchWithFuzzy,
} from "./stringFormatters";

describe("stringFormatters", () => {
  describe("getHostname", () => {
    it.each([
      ["https://example.com/page", "example.com"],
      ["https://www.example.com/page", "example.com"],
      // A subdomain survives.
      ["https://docs.example.com/page", "docs.example.com"],
      // Anchored, so `www.` deeper in the host stays.
      ["https://my.www.example.com/page", "my.www.example.com"],
      // Anchored, so an overlapping `www.` at offset 1 is not a prefix.
      ["https://wwww.example.com/page", "wwww.example.com"],
      // The strip runs once, not per occurrence.
      ["https://www.www.example.com/page", "www.example.com"],
      // The hostname, so the port stays out of it.
      ["https://localhost:3000", "localhost"],
      // Not a URL at all: hand back what came in, for display.
      ["not-a-url", "not-a-url"],
    ])("turns %s into %s", (url, expected) => {
      expect(getHostname(url)).toBe(expected);
    });
  });

  describe("getSemanticVersion", () => {
    it.each([
      [1700000000000, "2023.11.14"],
      // Built in UTC, because the formatter reads UTC fields: a local-time Date
      // would format as the day before for anyone east of UTC.
      [new Date(Date.UTC(2024, 0, 15)), "2024.1.15"],
      // Read as UTC, so the fixture pins the same instant on every runner.
      ["2024-06-01", "2024.6.1"],
    ])("dates %s as %s", (date, expected) => {
      expect(getSemanticVersion(date)).toBe(expected);
    });

    it("does not follow the runner's timezone", () => {
      const originalTimeZone = process.env.TZ;
      try {
        // A UTC-midnight instant reads as the previous day only in a zone
        // behind UTC; a zone ahead of it needs a late-in-the-day instant to
        // read as the next day. So each direction pins its own. The
        // getDate() checks make a silent no-op of the zone change fail
        // loudly instead of passing vacuously.
        process.env.TZ = "Pacific/Pago_Pago"; // UTC-11
        const westMidnight = new Date(Date.UTC(2024, 0, 15));
        expect(westMidnight.getDate()).toBe(14);
        expect(getSemanticVersion(westMidnight)).toBe("2024.1.15");
        process.env.TZ = "Pacific/Kiritimati"; // UTC+14
        const eastLate = new Date(Date.UTC(2024, 5, 1, 23));
        expect(eastLate.getDate()).toBe(2);
        expect(getSemanticVersion(eastLate)).toBe("2024.6.1");
      } finally {
        if (originalTimeZone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimeZone;
      }
    });
  });

  describe("formatRelativeTime", () => {
    // The function reads Date.now() itself, so under real time the ms between the
    // test's Date.now() and the function's can only push a fixture further into
    // the past, out of its bucket for any row sitting at a bucket's top edge.
    // A frozen clock puts every row exactly on its cutoff.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    // Each row sits at a branch cutoff, where an off-by-one would flip the
    // output to the adjacent form.
    it.each([
      ["the current instant is Just now", 0, "Just now"],
      ["the last ms under a minute is still Just now", 59_999, "Just now"],
      ["one minute rolls up to 1m ago", 60_000, "1m ago"],
      ["59 minutes stays in minutes", 59 * 60_000, "59m ago"],
      ["60 minutes rolls up to an hour", 60 * 60_000, "1h ago"],
      ["90 minutes truncates to the hour", 90 * 60_000, "1h ago"],
      ["23 hours stays in hours", 23 * 3_600_000, "23h ago"],
      ["24 hours rolls up to a day", 24 * 3_600_000, "1d ago"],
      ["36 hours truncates to the day", 36 * 3_600_000, "1d ago"],
      ["6 days stays in days", 6 * 86_400_000, "6d ago"],
    ])("%s", (_, offsetMs, expected) => {
      expect(formatRelativeTime(Date.now() - offsetMs)).toBe(expected);
    });

    it("rolls up to the locale date at 7 days", () => {
      const sevenDaysAgo = Date.now() - 7 * 86_400_000;
      expect(formatRelativeTime(sevenDaysAgo)).toBe(
        new Date(sevenDaysAgo).toLocaleDateString(),
      );
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

    it("should rank the matches and score them by rank", () => {
      // Listed with the weaker match first, so document order cannot produce
      // the expected result: uFuzzy's ranking has to be what orders these.
      const results = searchWithFuzzy(
        [
          { id: 2, name: "application" },
          { id: 1, name: "apple" },
          { id: 3, name: "banana" },
        ],
        "app",
        (item) => item.name,
      );

      expect(results.map(({ item, score }) => [item.name, score])).toEqual([
        ["apple", 1],
        ["application", 0.5],
      ]);
    });
  });

  describe("groupSearchResultsByDate", () => {
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
