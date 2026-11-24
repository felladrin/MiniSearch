import { describe, expect, it } from "vitest";
import {
  normalizeFollowUpDates,
  normalizeRelativeDates,
} from "./relativeDates";

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

    it("trims the query on both sides when an anchor is appended", () => {
      expect(normalizeRelativeDates("  next year  ", AS_OF).searchQuery).toBe(
        "next year 2027",
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

  it("cuts an over-long query with no relative date to the limit", () => {
    const long = "x".repeat(2100);

    expect(
      normalizeRelativeDates(long, new Date(2026, 10, 3), { maxLength: 2000 }),
    ).toEqual({ searchQuery: "x".repeat(2000), replacements: [] });
  });

  it("cuts an over-long query whose anchor no longer fits to the limit", () => {
    const long = `${"x".repeat(2095)} next year`;

    expect(
      normalizeRelativeDates(long, new Date(2026, 10, 3), { maxLength: 2000 }),
    ).toEqual({ searchQuery: "x".repeat(2000), replacements: [] });
  });

  it("drops the trailing space left by the cut", () => {
    const long = `${"x".repeat(1999)} ${"y".repeat(100)}`;

    expect(
      normalizeRelativeDates(long, new Date(2026, 10, 3), { maxLength: 2000 })
        .searchQuery,
    ).toBe("x".repeat(1999));
  });

  describe("spelling variants", () => {
    it.each(["'", "\u2018", "\u2019", "\u02bc", "\uff07"])(
      "skips the possessive headline form with the apostrophe %j",
      (apostrophe) => {
        const query = `next year${apostrophe}s champion`;

        expect(normalizeRelativeDates(query, AS_OF)).toEqual({
          searchQuery: query,
          replacements: [],
        });
      },
    );

    it.each([
      "last\u00a0month\u00a0of pregnancy symptoms",
      "last  month of pregnancy symptoms",
      "the last\u00a0year\u00a0of college",
    ])("skips a blacklisted phrase written with odd spacing: %j", (query) => {
      expect(normalizeRelativeDates(query, AS_OF)).toEqual({
        searchQuery: query,
        replacements: [],
      });
    });

    it.each(["next\u00a0year", "next  year"])(
      "anchors a trigger written with the spacing %j",
      (phrase) => {
        expect(normalizeRelativeDates(`${phrase} champion`, AS_OF)).toEqual({
          searchQuery: `${phrase} champion 2027`,
          replacements: [{ phrase, anchor: "2027" }],
        });
      },
    );

    it("reports the phrase as typed after a letter that grows when lowercased", () => {
      // "İ".toLowerCase() is two code units, which used to shift every index
      // computed on the lowercased copy.
      expect(normalizeRelativeDates("İstanbul next year", AS_OF)).toEqual({
        searchQuery: "İstanbul next year 2027",
        replacements: [{ phrase: "next year", anchor: "2027" }],
      });
    });
  });

  describe("dates the query already carries", () => {
    it.each([
      "events in 2026 December next month",
      "events in December 2026 next month",
      "events in Dec 2026 next month",
      "events in Dec. 2026 next month",
      "events in Sept 2026 and 2026-12 next month",
      "events in 2026-12 next month",
      "events in 2026/12 next month",
    ])("does not add December 2026 to %j", (query) => {
      expect(normalizeRelativeDates(query, AS_OF)).toEqual({
        searchQuery: query,
        replacements: [],
      });
    });

    it.each(["2026年12月的活动 下个月", "2026 年 12 月的活动 下个月"])(
      "does not add 2026年12月 to %j",
      (query) => {
        expect(normalizeRelativeDates(query, AS_OF)).toEqual({
          searchQuery: query,
          replacements: [],
        });
      },
    );

    it("still adds a month when the query names only the year", () => {
      expect(
        normalizeRelativeDates("events in 2026 next month", AS_OF),
      ).toEqual({
        searchQuery: "events in 2026 next month December 2026",
        replacements: [{ phrase: "next month", anchor: "December 2026" }],
      });
    });

    it("still adds a month when the query names another month", () => {
      expect(
        normalizeRelativeDates("events in January 2026 next month", AS_OF)
          .replacements,
      ).toEqual([{ phrase: "next month", anchor: "December 2026" }]);
    });

    it("does not take a year inside a longer number for a year", () => {
      expect(normalizeRelativeDates("ticket 120265 this year", AS_OF)).toEqual({
        searchQuery: "ticket 120265 this year 2026",
        replacements: [{ phrase: "this year", anchor: "2026" }],
      });
    });

    it("does not take a season for a month", () => {
      // 2011-12 is a season (the second number follows the first year), not
      // December 2011, so next month's anchor is still worth adding.
      expect(
        normalizeRelativeDates(
          "2011-12 season next month",
          new Date(2011, 10, 3, 12),
        ).replacements,
      ).toEqual([{ phrase: "next month", anchor: "December 2011" }]);
    });
  });

  describe("which month a written date carries", () => {
    const JANUARY_2026 = new Date(2026, 0, 10, 12);

    it("takes the month written inside the date over a month name behind it", () => {
      // "Nov" belongs to "Nov 2026", not to 2026-12, so December is written.
      expect(
        normalizeRelativeDates("report 2026-12 Nov 2026 next month", AS_OF),
      ).toEqual({
        searchQuery: "report 2026-12 Nov 2026 next month",
        replacements: [],
      });
      expect(
        normalizeRelativeDates("2026年12月 November 2026 next month", AS_OF)
          .replacements,
      ).toEqual([]);
    });

    it("gives a month name to the date it stands in front of, not the one before", () => {
      // "2023-2025 Dec 2026" is a range, then December 2026. December 2025,
      // which last month resolves to in January 2026, is not written.
      expect(
        normalizeRelativeDates("2023-2025 Dec 2026 last month", JANUARY_2026)
          .replacements,
      ).toEqual([{ phrase: "last month", anchor: "December 2025" }]);
    });

    it("does not give a month to a year range", () => {
      expect(
        normalizeRelativeDates("2023-2025 December last month", JANUARY_2026)
          .replacements,
      ).toEqual([{ phrase: "last month", anchor: "December 2025" }]);
    });

    it("gives a month name in front of a range to its first year only", () => {
      expect(
        normalizeRelativeDates("December 2025-2027 last month", JANUARY_2026)
          .replacements,
      ).toEqual([]);
      expect(
        normalizeRelativeDates("December 2023-2025 last month", JANUARY_2026)
          .replacements,
      ).toEqual([{ phrase: "last month", anchor: "December 2025" }]);
    });
  });
});

describe("normalizeFollowUpDates", () => {
  it.each([
    [
      "who won it last year",
      "who won world series 2026",
      "who won world series 2025",
    ],
    [
      "what comes out next month",
      "Disney Plus new releases November 2026",
      "Disney Plus new releases December 2026",
    ],
    [
      "what comes out next month",
      "disney plus new releases november 2026",
      "disney plus new releases December 2026",
    ],
    ["明年的呢", "苹果 2025 新手机 发布时间", "苹果 新手机 发布时间 2027年"],
    ["明年的呢", "iPhone 16发布时间 2027", "iPhone 16发布时间 2027年"],
    ["明年的呢", "苹果 2026年11月 发布会", "苹果 发布会 2027年"],
    ["明年的呢", "2025 年 iPhone 发布日期新闻", "iPhone 发布日期新闻 2027年"],
    [
      "what happened last year",
      "WWE Crown Jewel incidents 2023-2025",
      "WWE Crown Jewel incidents 2025",
    ],
    [
      "who won it last year",
      "Premier League winner 2024-25",
      "Premier League winner 2025",
    ],
  ])("anchors %s onto %s", (question, query, searchQuery) => {
    expect(normalizeFollowUpDates(query, [question], AS_OF).searchQuery).toBe(
      searchQuery,
    );
  });

  it("keeps a year the user typed in the question", () => {
    expect(
      normalizeFollowUpDates(
        "2024 model vs 2023 model",
        ["is the 2024 model better than last year's"],
        AS_OF,
      ).searchQuery,
    ).toBe("2024 model vs model 2025");
  });

  it("keeps a year the user typed in an earlier message", () => {
    expect(
      normalizeFollowUpDates(
        "Cyberpunk 2077 sales 2026",
        ["cyberpunk 2077", "how did it sell last year"],
        AS_OF,
      ).searchQuery,
    ).toBe("Cyberpunk 2077 sales 2025");
  });

  it("keeps a number after a spaced dash, which is not a season", () => {
    expect(
      normalizeFollowUpDates(
        "best TVs 2026 - 55 inch",
        ["what were the best TVs last year"],
        AS_OF,
      ).searchQuery,
    ).toBe("best TVs - 55 inch 2025");
  });

  it("leaves the model's dates alone when the question has no relative date", () => {
    expect(
      normalizeFollowUpDates("world series 2023 winner", ["who won it"], AS_OF)
        .searchQuery,
    ).toBe("world series 2023 winner");
  });

  it("drops an anchor that would pass the length limit", () => {
    expect(
      normalizeFollowUpDates("who won 2026", ["who won it last year"], AS_OF, {
        maxLength: 9,
      }).searchQuery,
    ).toBe("who won");
  });

  it("cuts an over-long query to the limit", () => {
    const long = "x".repeat(2100);

    expect(
      normalizeFollowUpDates(long, [long], AS_OF, { maxLength: 2000 })
        .searchQuery,
    ).toBe("x".repeat(2000));
    expect(
      normalizeFollowUpDates(long, ["who won it last year"], AS_OF, {
        maxLength: 2000,
      }).searchQuery,
    ).toHaveLength(2000);
  });

  describe("anchors already written", () => {
    it("does not repeat a year the user typed that the anchor resolves to", () => {
      expect(
        normalizeFollowUpDates(
          "2025 election results",
          ["2025 election results", "what happened last year?"],
          AS_OF,
        ),
      ).toEqual({ searchQuery: "2025 election results", replacements: [] });
    });

    it("does not repeat a month the user typed, written another way", () => {
      expect(
        normalizeFollowUpDates(
          "new releases in Dec 2026",
          ["new releases in Dec 2026", "and next month?"],
          AS_OF,
        ),
      ).toEqual({ searchQuery: "new releases in Dec 2026", replacements: [] });
    });

    it("keeps the anchor that is not already written", () => {
      expect(
        normalizeFollowUpDates(
          "2025 election results",
          ["2025 election results", "and what about next year?"],
          AS_OF,
        ).searchQuery,
      ).toBe("2025 election results 2027");
    });
  });

  describe("a query that is only a written date", () => {
    it("gets its anchor without a leading space", () => {
      expect(
        normalizeFollowUpDates("2025", ["what happened last year?"], AS_OF),
      ).toEqual({
        searchQuery: "2025",
        replacements: [{ phrase: "last year", anchor: "2025" }],
      });
    });

    it.each(["2025", "  2025  ", "2024-25", "2026年"])(
      "returns a trimmed query for the model's %j",
      (query) => {
        const result = normalizeFollowUpDates(
          query,
          ["what happened last year?"],
          AS_OF,
        );

        expect(result.replacements).not.toEqual([]);
        expect(result.searchQuery).toBe(result.searchQuery.trim());
      },
    );
  });

  describe("abbreviated months", () => {
    it("drops the model's abbreviated month together with its year", () => {
      // Only the year used to go, which left a dangling "Dec" in the query.
      expect(
        normalizeFollowUpDates("results and Dec 2026", ["what 去年"], AS_OF),
      ).toEqual({
        searchQuery: "results and 2025年",
        replacements: [{ phrase: "去年", anchor: "2025年" }],
      });
    });
  });
});
