import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isOfficialLaneEnabled,
  MAX_OFFICIAL_LANE_RESULTS,
  mergeOfficialLaneResults,
  officialLaneRequest,
} from "./officialLane.ts";

type TextResult = [title: string, content: string, url: string];

const results = (...urls: string[]): TextResult[] =>
  urls.map((url) => ["title", "snippet", url]);

describe("officialLaneRequest", () => {
  it("asks for the named site's official page", () => {
    expect(
      officialLaneRequest(
        "disney 下个月排片",
        results("https://news.example.com/a", "https://www.disney.com/movies"),
      ),
    ).toEqual({
      domain: "disney.com",
      query: "site:disney.com disney 下个月排片",
    });
  });

  it("treats a subdomain as the same site", () => {
    expect(
      officialLaneRequest(
        "disney official parking hours",
        results("https://investor.disney.com/reports"),
      )?.domain,
    ).toBe("disney.com");
  });

  it("recognises a label spelled by the query's own words", () => {
    expect(
      officialLaneRequest(
        "disney plus showtimes",
        results("https://www.disneyplus.com/welcome"),
      )?.domain,
    ).toBe("disneyplus.com");
  });

  it("reads the English intent words on their own", () => {
    for (const query of [
      "disney hours",
      "disney opening times",
      "disney tickets",
      "disney pricing",
      "disney schedule",
      "disney showtimes",
      "disney timetable",
    ]) {
      expect(
        officialLaneRequest(query, results("https://disney.com/"))?.domain,
        query,
      ).toBe("disney.com");
    }
  });

  it("needs navigation intent, not just a named site", () => {
    expect(
      officialLaneRequest(
        "disney movie reviews",
        results("https://disney.com/"),
      ),
    ).toBeNull();
  });

  it("needs a result that already names the site", () => {
    expect(
      officialLaneRequest(
        "disney showtimes",
        results(
          "https://www.fandango.com/disney",
          "https://www.imdb.com/title",
        ),
      ),
    ).toBeNull();
  });

  it("ignores a result whose label is not the query's word", () => {
    expect(
      officialLaneRequest(
        "disney showtimes",
        results("https://disneyfan.com/showtimes"),
      ),
    ).toBeNull();
  });

  it("never scopes a host with no registrable domain", () => {
    for (const url of [
      "http://127.0.0.1:8888/search?q=disney",
      "http://localhost:5173/",
      "not a url",
    ]) {
      expect(
        officialLaneRequest("disney showtimes", results(url)),
        url,
      ).toBeNull();
    }
  });

  it("never scopes a whole country suffix", () => {
    expect(
      officialLaneRequest(
        "amazon.com hours",
        results("https://shop.example.com.hk/x"),
      ),
    ).toBeNull();
  });

  it("does not scope a query too long to carry the prefix", () => {
    const query = `disney showtimes ${"x".repeat(2000)}`;
    expect(
      officialLaneRequest(query, results("https://disney.com/")),
    ).toBeNull();
  });
});

describe("mergeOfficialLaneResults", () => {
  const main = results(
    "https://aggregator.example.com/disney",
    "https://news.example.com/disney",
  );

  it("places the lane's pages behind the pinned first result", () => {
    expect(
      mergeOfficialLaneResults(
        main,
        results("https://disney.com/schedule"),
        "disney.com",
      ),
    ).toEqual([
      main[0],
      ["title", "snippet", "https://disney.com/schedule"],
      main[1],
    ]);
  });

  it("leaves a page the main set already has alone", () => {
    expect(
      mergeOfficialLaneResults(main, results(main[0][2]), "disney.com"),
    ).toBe(main);
  });

  it("reads the http and https spellings of a page as one page", () => {
    const withOfficialPage = results(
      "https://disney.com/schedule",
      "https://news.example.com/disney",
    );

    expect(
      mergeOfficialLaneResults(
        withOfficialPage,
        results("http://disney.com/schedule/"),
        "disney.com",
      ),
    ).toBe(withOfficialPage);
  });

  it("drops a host the engine returned outside the scope", () => {
    expect(
      mergeOfficialLaneResults(
        main,
        results("https://fandango.com/x"),
        "disney.com",
      ),
    ).toBe(main);
  });

  it(`adds at most ${MAX_OFFICIAL_LANE_RESULTS} pages`, () => {
    const laneResults = results(
      "https://disney.com/1",
      "https://disney.com/2",
      "https://disney.com/3",
      "https://disney.com/4",
    );

    const merged = mergeOfficialLaneResults(main, laneResults, "disney.com");

    expect(merged.length).toBe(main.length + MAX_OFFICIAL_LANE_RESULTS);
  });

  it("changes nothing when the main set is empty", () => {
    expect(
      mergeOfficialLaneResults(
        [],
        results("https://disney.com/"),
        "disney.com",
      ),
    ).toEqual([]);
  });
});

describe("isOfficialLaneEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off unless the environment turns it on", () => {
    for (const value of ["", "false", "0", "off", "yes"]) {
      vi.stubEnv("SEARCH_OFFICIAL_LANE_ENABLED", value);
      expect(isOfficialLaneEnabled(), value).toBe(false);
    }
  });

  it("accepts 'true', ' TRUE ' and '1'", () => {
    for (const value of ["true", " TRUE ", "1"]) {
      vi.stubEnv("SEARCH_OFFICIAL_LANE_ENABLED", value);
      expect(isOfficialLaneEnabled(), value).toBe(true);
    }
  });
});
