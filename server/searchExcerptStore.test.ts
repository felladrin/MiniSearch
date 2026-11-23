import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoreModule = typeof import("./searchExcerptStore");
let rememberSearchExcerpts: StoreModule["rememberSearchExcerpts"];
let recallSearchExcerpts: StoreModule["recallSearchExcerpts"];

beforeEach(async () => {
  // A fresh store per test, since the entries are module state.
  vi.resetModules();
  ({ rememberSearchExcerpts, recallSearchExcerpts } = await import(
    "./searchExcerptStore"
  ));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("searchExcerptStore", () => {
  it("returns the text only for the query and URL it was stored under", () => {
    rememberSearchExcerpts("heat pumps", "https://example.com/a", "Text A");

    expect(recallSearchExcerpts("heat pumps", "https://example.com/a")).toBe(
      "Text A",
    );
    expect(recallSearchExcerpts(" heat pumps ", "https://example.com/a")).toBe(
      "Text A",
    );
    expect(
      recallSearchExcerpts("heat pump", "https://example.com/a"),
    ).toBeUndefined();
    expect(
      recallSearchExcerpts("heat pumps", "https://example.com/b"),
    ).toBeUndefined();
  });

  it("forgets an entry after five minutes", () => {
    vi.useFakeTimers();
    rememberSearchExcerpts("q", "https://example.com/a", "Text");

    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(recallSearchExcerpts("q", "https://example.com/a")).toBe("Text");

    vi.advanceTimersByTime(1);
    expect(recallSearchExcerpts("q", "https://example.com/a")).toBeUndefined();
  });

  it("drops the oldest entries beyond 500", () => {
    for (let index = 0; index <= 500; index++) {
      rememberSearchExcerpts("q", `https://example.com/${index}`, `${index}`);
    }

    expect(recallSearchExcerpts("q", "https://example.com/0")).toBeUndefined();
    expect(recallSearchExcerpts("q", "https://example.com/1")).toBe("1");
    expect(recallSearchExcerpts("q", "https://example.com/500")).toBe("500");
  });
});
