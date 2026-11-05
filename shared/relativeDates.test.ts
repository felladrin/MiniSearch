import { describe, expect, it } from "vitest";
import { normalizeRelativeDates } from "./relativeDates";

/** 3 November 2026, midday. Every expectation below is relative to this. */
const AS_OF = new Date(2026, 10, 3, 12);

/** 15 December 2026, the fixture for month and year rollover. */
const AS_OF_DECEMBER = new Date(2026, 11, 15, 12);

describe("normalizeRelativeDates", () => {
  describe("appended anchors", () => {
    it("appends the resolved year to a query with a Chinese year word", () => {
      expect(
        normalizeRelativeDates("明年的wrestlemania在哪里举办", AS_OF),
      ).toEqual({
        searchQuery: "明年的wrestlemania在哪里举办 2027年",
        replacements: [{ phrase: "明年", anchor: "2027年" }],
      });
    });

    it("appends an English month name for next month", () => {
      expect(
        normalizeRelativeDates("new series on disney plus next month", AS_OF),
      ).toEqual({
        searchQuery: "new series on disney plus next month December 2026",
        replacements: [{ phrase: "next month", anchor: "December 2026" }],
      });
    });

    it("leaves a query with no date word untouched", () => {
      expect(
        normalizeRelativeDates("the result of most recent ufc event", AS_OF),
      ).toEqual({
        searchQuery: "the result of most recent ufc event",
        replacements: [],
      });
    });

    it("treats recent-style words as no-ops", () => {
      for (const query of [
        "最近 ufc",
        "最新的比赛结果",
        "近期赛事",
        "latest ufc event",
        "recent ufc event",
      ]) {
        expect(normalizeRelativeDates(query, AS_OF)).toEqual({
          searchQuery: query,
          replacements: [],
        });
      }
    });

    it("matches English triggers case-insensitively", () => {
      expect(normalizeRelativeDates("Next Year", AS_OF)).toEqual({
        searchQuery: "Next Year 2027",
        replacements: [{ phrase: "Next Year", anchor: "2027" }],
      });
    });

    it("appends both a Chinese and an English anchor in one query", () => {
      expect(normalizeRelativeDates("明年 and next month", AS_OF)).toEqual({
        searchQuery: "明年 and next month 2027年 December 2026",
        replacements: [
          { phrase: "明年", anchor: "2027年" },
          { phrase: "next month", anchor: "December 2026" },
        ],
      });
    });

    it("rolls a December month word into January of the next year", () => {
      expect(normalizeRelativeDates("下个月", AS_OF_DECEMBER)).toEqual({
        searchQuery: "下个月 2027年1月",
        replacements: [{ phrase: "下个月", anchor: "2027年1月" }],
      });
    });

    it("keeps at most two anchors, in the order they appear", () => {
      expect(
        normalizeRelativeDates("明年的活动 今年的活动 去年的活动", AS_OF),
      ).toEqual({
        searchQuery: "明年的活动 今年的活动 去年的活动 2027年 2026年",
        replacements: [
          { phrase: "明年", anchor: "2027年" },
          { phrase: "今年", anchor: "2026年" },
        ],
      });
    });

    it("does not repeat a year the query already spells out", () => {
      const result = normalizeRelativeDates(
        "2027年的wrestlemania 明年在哪",
        AS_OF,
      );

      expect(result.replacements).toEqual([]);
      expect(result.searchQuery).toBe("2027年的wrestlemania 明年在哪");
      expect(result.searchQuery.match(/2027年/g)).toHaveLength(1);
    });

    it("collapses two phrases that resolve to the same anchor", () => {
      expect(normalizeRelativeDates("这个月 和 本月 都下雨", AS_OF)).toEqual({
        searchQuery: "这个月 和 本月 都下雨 2026年11月",
        replacements: [{ phrase: "这个月", anchor: "2026年11月" }],
      });
    });

    it("appends a trailing anchor without doubling the separator", () => {
      expect(normalizeRelativeDates("下个月几号 ", AS_OF).searchQuery).toBe(
        "下个月几号 2026年12月",
      );
    });

    it("leaves an empty query alone", () => {
      for (const query of ["", "   "]) {
        expect(normalizeRelativeDates(query, AS_OF)).toEqual({
          searchQuery: query,
          replacements: [],
        });
      }
    });
  });

  describe("blacklist", () => {
    it("skips a word that belongs to a longer title", () => {
      for (const query of [
        "明年今日 电影",
        "去年冬天",
        "去年夏天",
        "人类第一次登上月球是哪一年",
        "last month of pregnancy symptoms",
        "last year of college",
      ]) {
        expect(normalizeRelativeDates(query, AS_OF)).toEqual({
          searchQuery: query,
          replacements: [],
        });
      }
    });

    it("skips the possessive headline form", () => {
      expect(normalizeRelativeDates("next year's champion", AS_OF)).toEqual({
        searchQuery: "next year's champion",
        replacements: [],
      });
    });

    it("leaves day words alone", () => {
      for (const query of [
        "明天几点",
        "昨天的比赛",
        "今日头条",
        "高铁票提前天数",
        "what happened yesterday",
        "today show hosts",
        "the day after tomorrow cast",
      ]) {
        expect(normalizeRelativeDates(query, AS_OF)).toEqual({
          searchQuery: query,
          replacements: [],
        });
      }
    });
  });

  describe("anchor table", () => {
    it("resolves the Chinese year words", () => {
      const anchors = (query: string) =>
        normalizeRelativeDates(query, AS_OF).replacements.map(
          (replacement) => replacement.anchor,
        );

      expect(anchors("去年")).toEqual(["2025年"]);
    });

    it("resolves the Chinese month words", () => {
      const anchors = (query: string) =>
        normalizeRelativeDates(query, AS_OF).replacements.map(
          (replacement) => replacement.anchor,
        );

      expect(anchors("上个月")).toEqual(["2026年10月"]);
      expect(anchors("上月")).toEqual(["2026年10月"]);
      expect(anchors("本月")).toEqual(["2026年11月"]);
      expect(anchors("这个月")).toEqual(["2026年11月"]);
    });

    it("resolves the English year words", () => {
      expect(normalizeRelativeDates("this year", AS_OF).replacements).toEqual([
        { phrase: "this year", anchor: "2026" },
      ]);
      expect(normalizeRelativeDates("last year", AS_OF).replacements).toEqual([
        { phrase: "last year", anchor: "2025" },
      ]);
    });

    it("rolls last month across a year boundary", () => {
      expect(
        normalizeRelativeDates("last month", new Date(2026, 0, 15, 12))
          .replacements,
      ).toEqual([{ phrase: "last month", anchor: "December 2025" }]);
    });
  });

  describe("English word boundaries", () => {
    it("does not match a trigger inside a longer word", () => {
      for (const query of [
        "this yearly report",
        "next monthly plan",
        "last years",
      ]) {
        expect(normalizeRelativeDates(query, AS_OF)).toEqual({
          searchQuery: query,
          replacements: [],
        });
      }
    });
  });
  it("drops an anchor that would push the query past the limit", () => {
    const long = `${"x".repeat(1990)} next year`;

    expect(
      normalizeRelativeDates(long, new Date(2026, 10, 3), { maxLength: 2000 }),
    ).toEqual({
      searchQuery: long,
      replacements: [],
    });
  });

  it("keeps the anchors that still fit", () => {
    const long = `${"x".repeat(1970)} next year next month`;

    const { searchQuery } = normalizeRelativeDates(
      long,
      new Date(2026, 10, 3),
      {
        maxLength: 2000,
      },
    );

    expect(searchQuery.endsWith("2027")).toBe(true);
    expect(searchQuery).not.toContain("December 2026");
    expect(searchQuery.length).toBeLessThanOrEqual(2000);
  });
});
