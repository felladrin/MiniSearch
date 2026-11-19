import { describe, expect, it } from "vitest";
import { selectLlmSearchResults } from "./searchResultSelection";
import type { TextSearchResults } from "./types";

const result = (title: string, score?: number) =>
  [title, `${title} snippet`, `https://example.com/${title}`, score] as const;

describe("selectLlmSearchResults", () => {
  it("takes the first results in engine order when nothing is scored", () => {
    const results: TextSearchResults = [
      [...result("pinned")],
      [...result("second")],
      [...result("third")],
      [...result("fourth")],
    ];

    expect(selectLlmSearchResults(results, 2).map(([title]) => title)).toEqual([
      "pinned",
      "second",
    ]);
  });

  it("prefers the highest scores over the pinned first result", () => {
    const results: TextSearchResults = [
      [...result("pinned-ad", 12)],
      [...result("relevant-a", 91)],
      [...result("relevant-b", 87)],
      [...result("weak", 20)],
    ];

    expect(selectLlmSearchResults(results, 2).map(([title]) => title)).toEqual([
      "relevant-a",
      "relevant-b",
    ]);
  });

  it("keeps the input order between equal scores", () => {
    const results: TextSearchResults = [
      [...result("first", 50)],
      [...result("second", 50)],
      [...result("third", 50)],
    ];

    expect(selectLlmSearchResults(results, 2).map(([title]) => title)).toEqual([
      "first",
      "second",
    ]);
  });

  it("does not mutate the caller's results", () => {
    const results: TextSearchResults = [
      [...result("pinned", 1)],
      [...result("relevant", 99)],
    ];

    selectLlmSearchResults(results, 1);

    expect(results.map(([title]) => title)).toEqual(["pinned", "relevant"]);
  });

  it("returns everything when the limit is larger than the list", () => {
    const results: TextSearchResults = [[...result("only", 42)]];

    expect(selectLlmSearchResults(results, 6)).toHaveLength(1);
  });
});
