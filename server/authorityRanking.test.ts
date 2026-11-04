import { describe, expect, it } from "vitest";

import { authorityBoostMultiplier } from "./authorityRanking.ts";

const boosted = (query: string, url: string, title = "", snippet = "") =>
  authorityBoostMultiplier(query, title, snippet, url);

describe("authorityBoostMultiplier", () => {
  it("leaves unrelated results alone", () => {
    expect(
      boosted("disney movie schedule", "https://www.fandango.com/disney"),
    ).toBe(1);
  });

  it("boosts the site whose name the query uses", () => {
    expect(boosted("disney movie schedule", "https://disney.com/movies")).toBe(
      1.2,
    );
  });

  it("treats subdomains as the same site", () => {
    expect(
      boosted("disney annual report", "https://investor.disney.com/reports"),
    ).toBe(1.2);
  });

  it("boosts a label spelled by the query's own words", () => {
    expect(
      boosted("disney plus next month", "https://www.disneyplus.com/welcome"),
    ).toBe(1.25);
  });

  it("reads a trailing plus as the word plus", () => {
    expect(
      boosted("disney+ next month", "https://www.disneyplus.com/welcome"),
    ).toBe(1.25);
  });

  it("boosts hyphenated labels split across the query's words", () => {
    expect(
      boosted("coca cola profit", "https://www.coca-cola.com/business"),
    ).toBe(1.25);
  });

  it("does not match a label that only contains the query token", () => {
    expect(boosted("disney tickets", "https://disneyfan.com/tickets")).toBe(1);
  });

  it("does not treat the label as a word of a longer query word", () => {
    expect(
      boosted("disneyland paris tickets", "https://disney.com/tickets"),
    ).toBe(1);
  });

  it("ignores filler words that happen to be a domain", () => {
    expect(boosted("the plus size guide", "https://plus.com/guide")).toBe(1);
    expect(boosted("news about disney", "https://news.com/disney")).toBe(1);
  });

  it("keeps short brand names of three letters", () => {
    expect(boosted("wwe next ple", "https://www.wwe.com/events")).toBe(1.2);
    expect(boosted("bbc coverage", "https://www.bbc.co.uk/news")).toBe(1.2);
  });

  it("does not boost a page that cannot support the year in the query", () => {
    expect(
      boosted(
        "wrestlemania 43 host city 2027",
        "https://www.wwe.com/shows/wrestlemania",
        "WrestleMania 42 recap",
        "Las Vegas hosted the 2026 event",
      ),
    ).toBe(1);
  });

  it("boosts a page that mentions the year in the query", () => {
    expect(
      boosted(
        "wwe wrestlemania 43 host city 2027",
        "https://www.wwe.com/shows/wrestlemania",
        "WrestleMania 43 heads to Riyadh in 2027",
        "",
      ),
    ).toBe(1.2);
  });

  it("returns 1 for a URL it cannot parse", () => {
    expect(boosted("disney", "not a url")).toBe(1);
  });

  it("returns 1 for a bare hostname without a dot", () => {
    expect(boosted("localhost", "http://localhost:8888/search")).toBe(1);
  });
});
