import { describe, expect, it } from "vitest";
import { normalizeRelativeDates } from "./relativeDates";

/** 3 November 2026, midday. Every expectation below is relative to this. */
const AS_OF = new Date(2026, 10, 3, 12);

/** 15 December 2026, the fixture for month and year rollover. */
const AS_OF_DECEMBER = new Date(2026, 11, 15, 12);

describe("normalizeRelativeDates", () => {
  describe("append strategy", () => {
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
      expect(normalizeRelativeDates("今天 和 今日 都下雨", AS_OF)).toEqual({
        searchQuery: "今天 和 今日 都下雨 2026-11-03",
        replacements: [{ phrase: "今天", anchor: "2026-11-03" }],
      });
    });

    it("appends a trailing anchor without doubling the separator", () => {
      expect(normalizeRelativeDates("明天几点 ", AS_OF).searchQuery).toBe(
        "明天几点 2026-11-04",
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

  describe("replace strategy", () => {
    it("swaps the phrase in place and keeps the rest of the query", () => {
      expect(
        normalizeRelativeDates("明年的wrestlemania", AS_OF, {
          strategy: "replace",
        }),
      ).toEqual({
        searchQuery: "2027年的wrestlemania",
        replacements: [{ phrase: "明年", anchor: "2027年" }],
      });
    });

    it("replaces two phrases without touching the text between them", () => {
      expect(
        normalizeRelativeDates("下个月和明年", AS_OF, {
          strategy: "replace",
        }).searchQuery,
      ).toBe("2026年12月和2027年");
    });

    it("replaces an English phrase with its month name", () => {
      expect(
        normalizeRelativeDates("new series on disney plus next month", AS_OF, {
          strategy: "replace",
        }).searchQuery,
      ).toBe("new series on disney plus December 2026");
    });

    it("is the default-free option: append wins when omitted", () => {
      const withOptions = normalizeRelativeDates("明天见", AS_OF, {});
      const withoutOptions = normalizeRelativeDates("明天见", AS_OF);

      expect(withOptions).toEqual(withoutOptions);
      expect(withoutOptions.searchQuery).toBe("明天见 2026-11-04");
    });
  });

  describe("blacklist", () => {
    it("skips a word that belongs to a longer title", () => {
      for (const query of [
        "明年今日 电影",
        "明天会更好",
        "明天你是否依然爱我",
        "去年冬天",
        "去年夏天",
        "tomorrow never dies",
        "yesterday once more",
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

    it("skips a three-day phrase rather than anchoring it as two days out", () => {
      for (const query of ["大后天出发", "大前天到的"]) {
        expect(normalizeRelativeDates(query, AS_OF)).toEqual({
          searchQuery: query,
          replacements: [],
        });
      }
    });

    it("leaves a bare title query alone but anchors the same word in a sentence", () => {
      expect(normalizeRelativeDates("yesterday", AS_OF)).toEqual({
        searchQuery: "yesterday",
        replacements: [],
      });
      expect(
        normalizeRelativeDates("what happened yesterday", AS_OF).searchQuery,
      ).toBe("what happened yesterday 2026-11-02");
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

    it("resolves the Chinese day words to ISO dates", () => {
      const anchors = (query: string) =>
        normalizeRelativeDates(query, AS_OF).replacements.map(
          (replacement) => replacement.anchor,
        );

      expect(anchors("后天")).toEqual(["2026-11-05"]);
      expect(anchors("昨天")).toEqual(["2026-11-02"]);
      expect(anchors("前天")).toEqual(["2026-11-01"]);
      expect(anchors("今天")).toEqual(["2026-11-03"]);
      expect(anchors("今日")).toEqual(["2026-11-03"]);
    });

    it("resolves the English year and day words", () => {
      expect(normalizeRelativeDates("this year", AS_OF).replacements).toEqual([
        { phrase: "this year", anchor: "2026" },
      ]);
      expect(normalizeRelativeDates("last year", AS_OF).replacements).toEqual([
        { phrase: "last year", anchor: "2025" },
      ]);
      expect(
        normalizeRelativeDates("today's weather", AS_OF).replacements,
      ).toEqual([{ phrase: "today", anchor: "2026-11-03" }]);
      expect(normalizeRelativeDates("tomorrow", AS_OF).replacements).toEqual([
        { phrase: "tomorrow", anchor: "2026-11-04" },
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
      for (const query of ["this yearly report", "todays", "yesterdays"]) {
        expect(normalizeRelativeDates(query, AS_OF)).toEqual({
          searchQuery: query,
          replacements: [],
        });
      }
    });
  });
});
