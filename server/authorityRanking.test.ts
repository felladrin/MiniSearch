import { describe, expect, it } from "vitest";

import { authorityBoost } from "./authorityRanking.ts";

const boosted = (query: string, url: string, title = "", snippet = "") =>
  authorityBoost(query, title, snippet, url);

describe("authorityBoost", () => {
  it("leaves unrelated results alone", () => {
    expect(
      boosted("disney movie schedule", "https://www.fandango.com/disney"),
    ).toBe(0);
  });

  it("boosts the site whose name the query uses", () => {
    expect(boosted("disney movie schedule", "https://disney.com/movies")).toBe(
      0.5,
    );
  });

  it("treats subdomains as the same site", () => {
    expect(
      boosted("disney annual report", "https://investor.disney.com/reports"),
    ).toBe(0.5);
  });

  it("boosts a label spelled by the query's own words", () => {
    expect(
      boosted("disney plus next month", "https://www.disneyplus.com/welcome"),
    ).toBe(0.75);
  });

  it("reads a trailing plus as the word plus", () => {
    expect(
      boosted("disney+ next month", "https://www.disneyplus.com/welcome"),
    ).toBe(0.75);
  });

  it("boosts hyphenated labels split across the query's words", () => {
    expect(boosted("coca cola", "https://www.coca-cola.com/business")).toBe(
      0.75,
    );
  });

  it("does not boost a label that spells only a prefix of the query", () => {
    expect(
      boosted("tesla investor relations", "https://teslainvestor.com/news"),
    ).toBe(0);
  });

  it("does not boost a label that starts with a generic query word", () => {
    expect(boosted("the disney store", "https://thedisney.com/shop")).toBe(0);
  });

  it("does not match a label that only contains the query token", () => {
    expect(boosted("disney tickets", "https://disneyfan.com/tickets")).toBe(0);
  });

  it("does not treat the label as a word of a longer query word", () => {
    expect(
      boosted("disneyland paris tickets", "https://disney.com/tickets"),
    ).toBe(0);
  });

  it("ignores filler words that happen to be a domain", () => {
    expect(boosted("the plus size guide", "https://plus.com/guide")).toBe(0);
    expect(boosted("news about disney", "https://news.com/disney")).toBe(0);
  });

  it("keeps short brand names of three letters", () => {
    expect(boosted("wwe next ple", "https://www.wwe.com/events")).toBe(0.5);
    expect(boosted("bbc coverage", "https://www.bbc.co.uk/news")).toBe(0.5);
  });

  it("does not boost a page that cannot support the year in the query", () => {
    expect(
      boosted(
        "wrestlemania 43 host city 2027",
        "https://www.wwe.com/shows/wrestlemania",
        "WrestleMania 42 recap",
        "Las Vegas hosted the 2026 event",
      ),
    ).toBe(0);
  });

  it("boosts a page that mentions the year in the query", () => {
    expect(
      boosted(
        "wwe wrestlemania 43 host city 2027",
        "https://www.wwe.com/shows/wrestlemania",
        "WrestleMania 43 heads to Riyadh in 2027",
        "",
      ),
    ).toBe(0.5);
  });

  it("returns 1 for a URL it cannot parse", () => {
    expect(boosted("disney", "not a url")).toBe(0);
  });

  it("returns 1 for a bare hostname without a dot", () => {
    expect(boosted("localhost", "http://localhost:8888/search")).toBe(0);
  });
  it("keeps the boost when the anchored query names a year the page omits", () => {
    expect(
      boosted(
        "whats new on disney plus next month December 2026",
        "https://www.disneyplus.com/explore",
        "What's new on Disney+",
        "December releases, updated as we learn more",
      ),
    ).toBe(0.75);
  });
});
