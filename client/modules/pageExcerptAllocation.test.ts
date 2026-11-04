import gptTokenizer from "gpt-tokenizer";
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

  it("keeps the window where the query occurs instead of the page opening", () => {
    const content = `${"navigation ".repeat(300)}Only Murders in the Building returns on December 8, 2026. ${"more body text ".repeat(300)}`;

    const [excerpt] = allocatePageExcerpts([content], 60, {
      query: "only murders",
    });

    expect(excerpt).toContain("Only Murders");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThan(content.length);
  });

  it("keeps the page opening when the query does not occur in it", () => {
    const content = "the opening sentence of the page. ".repeat(200);

    const [excerpt] = allocatePageExcerpts([content], 60, {
      query: "something absent",
    });

    expect(excerpt.startsWith("the opening sentence")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("picks the window that covers the most query terms", () => {
    const content = `${"filler ".repeat(200)}bravo ${"filler ".repeat(200)}charlie bravo ${"filler ".repeat(200)}`;

    const [excerpt] = allocatePageExcerpts([content], 60, {
      query: "bravo charlie",
    });

    expect(excerpt).toContain("charlie");
  });

  it("finds CJK terms through their bigrams", () => {
    const content = `${"開場白 ".repeat(200)}獨家月片單介紹 ${"結尾段落 ".repeat(200)}`;

    const [excerpt] = allocatePageExcerpts([content], 60, {
      query: "十二月片單",
    });

    expect(excerpt).toContain("月片單");
  });
  it("keeps the old prefix trim byte for byte when no query is given", () => {
    const content = "The quick brown fox jumps over the lazy dog. ".repeat(20);
    const tokens = gptTokenizer.encode(content);

    expect(allocatePageExcerpts([content], 100)[0]).toBe(
      `${gptTokenizer.decode(tokens.slice(0, 100)).trimEnd()}…`,
    );
  });
});
