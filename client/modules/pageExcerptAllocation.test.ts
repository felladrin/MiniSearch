import { describe, expect, it } from "vitest";
import { allocatePageExcerpts } from "./pageExcerptAllocation";

describe("allocatePageExcerpts", () => {
  it("keeps every page whole when the budget is generous", () => {
    const contents = ["short page", "another short page"];

    expect(allocatePageExcerpts(contents, 1000)).toEqual(contents);
  });

  it("keeps the empty slots of results without page content", () => {
    expect(allocatePageExcerpts(["", "content", ""], 1000)).toEqual([
      "",
      "content",
      "",
    ]);
  });

  it("lets a short page keep its text while a long one is trimmed", () => {
    const short = "a short page.";
    const long = "a much longer page. ".repeat(200);

    const [firstExcerpt, secondExcerpt] = allocatePageExcerpts(
      [long, short],
      120,
    );

    expect(secondExcerpt).toBe(short);
    expect(firstExcerpt.endsWith("…")).toBe(true);
    expect(firstExcerpt.length).toBeLessThan(long.length);
  });

  it("rolls a short page's leftover budget over to the longer ones", () => {
    const tiny = "tiny.";
    const long = "a much longer page. ".repeat(200);

    const [tinyExcerpt, firstLong, secondLong] = allocatePageExcerpts(
      [tiny, long, long],
      120,
    );

    expect(tinyExcerpt).toBe(tiny);
    expect(firstLong.endsWith("…")).toBe(true);
    expect(secondLong.endsWith("…")).toBe(true);
    // The two long pages split what the tiny one did not need, evenly.
    expect(Math.abs(firstLong.length - secondLong.length)).toBeLessThan(20);
  });

  it("returns nothing when there is no budget left", () => {
    expect(allocatePageExcerpts(["content", "more content"], 0)).toEqual([
      "",
      "",
    ]);
  });
});
