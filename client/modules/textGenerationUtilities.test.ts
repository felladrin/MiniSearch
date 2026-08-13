import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageContents, TextSearchResults } from "./types";

const state = vi.hoisted(() => ({
  searchResults: [] as unknown[],
  pageContents: {} as Record<string, string>,
  settings: { openAiContextLength: 4096 } as { openAiContextLength?: number },
}));

vi.mock("./pubSub", () => ({
  getLlmTextSearchResults: () => state.searchResults,
  getPageContents: () => state.pageContents,
  getQuery: () => "the query",
  getSearchPromise: vi.fn(),
  getSettings: () => state.settings,
  updateTextGenerationState: vi.fn(),
}));

vi.mock("./systemPrompt", () => ({
  getSystemPrompt: (searchResults: string) => `prompt: ${searchResults}`,
}));

import {
  allocatePageExcerpts,
  getFormattedSearchResults,
} from "./textGenerationUtilities";

const results: TextSearchResults = [
  ["First", "first snippet", "https://a.example/"],
  ["Second", "second snippet", "https://b.example/"],
];

function setPageContents(pageContents: PageContents) {
  state.pageContents = pageContents;
}

describe("getFormattedSearchResults", () => {
  beforeEach(() => {
    state.searchResults = results;
    state.settings = { openAiContextLength: 4096 };
    setPageContents({});
  });

  it("reports when there is nothing to ground the answer on", () => {
    state.searchResults = [];

    expect(getFormattedSearchResults(true)).toBe("None.");
  });

  it("lists title, snippet and URL when no page content was read", () => {
    expect(getFormattedSearchResults(true)).toBe(
      "• [First](https://a.example/) | first snippet\n" +
        "• [Second](https://b.example/) | second snippet",
    );
  });

  it("omits URLs when asked to", () => {
    expect(getFormattedSearchResults(false)).toBe(
      "• First | first snippet\n• Second | second snippet",
    );
  });

  it("appends the excerpt under the result it was read from", () => {
    setPageContents({
      "https://b.example/": "The page says something useful.",
    });

    expect(getFormattedSearchResults(true)).toBe(
      "• [First](https://a.example/) | first snippet\n" +
        "• [Second](https://b.example/) | second snippet\n" +
        "  Page excerpt: The page says something useful.",
    );
  });

  it("indents every line of a multi-passage excerpt", () => {
    setPageContents({
      "https://a.example/": "First passage.\nSecond passage.",
    });

    expect(getFormattedSearchResults(true)).toContain(
      "  Page excerpt: First passage.\n  Second passage.",
    );
  });

  it("trims the excerpt to the share of the context it may use", () => {
    const longPage = "sentence about cats. ".repeat(500);
    setPageContents({ "https://a.example/": longPage });
    state.settings = { openAiContextLength: 512 };

    const formatted = getFormattedSearchResults(true);

    expect(formatted).toContain("…");
    expect(formatted.length).toBeLessThan(longPage.length);
  });
});

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

  it("returns nothing when there is no budget left", () => {
    expect(allocatePageExcerpts(["content", "more content"], 0)).toEqual([
      "",
      "",
    ]);
  });
});
