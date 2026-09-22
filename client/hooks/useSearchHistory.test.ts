import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as historyModule from "@/modules/history";
import {
  addSearchToHistory,
  historyDatabase,
  type SearchEntry,
  type TextResults,
} from "@/modules/history";
import * as stringFormatters from "@/modules/stringFormatters";
import {
  FILTER_DEBOUNCE_MS,
  REFRESH_INTERVAL_MS,
  useSearchHistory,
} from "./useSearchHistory";

vi.mock("@/modules/logEntries", () => ({ addLogEntry: vi.fn() }));

// Pin auto-cleanup off so seeding is deterministic and pubSub's module-level
// localStorage reads stay out of the test.
vi.mock("@/modules/pubSub", () => ({
  getSettings: vi.fn(() => ({
    historyAutoCleanup: false,
    historyRetentionDays: 30,
    historyMaxEntries: 500,
    historyGroupByDate: false,
  })),
}));

const textResults: TextResults = {
  type: "text",
  items: [{ title: "t", url: "https://example.com/a", snippet: "s" }],
};

// "weather in lisbon" is the narrowing-trap entry: "wet" matches nothing,
// "weth" gains an insertion variant that matches it.
const SEEDED_QUERIES = [
  "weather in lisbon",
  "best pizza porto",
  "rust async tutorial",
];

const queriesOf = (entries: SearchEntry[]) => entries.map((e) => e.query);

/**
 * Fake timers exclude setImmediate/clearImmediate so fake-indexeddb keeps its
 * real scheduling and DB reads resolve on the real event loop, while the
 * debounce and the 30s interval run on the fake clock.
 */
beforeEach(async () => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });

  await historyDatabase.searches.clear();
  await historyDatabase.llmResponses.clear();
  await historyDatabase.chatHistory.clear();
  for (const query of SEEDED_QUERIES) {
    await addSearchToHistory(query, textResults);
  }
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Let the debounce fire and any pending work flush. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FILTER_DEBOUNCE_MS + 50);
  });
}

describe("useSearchHistory", () => {
  it("reads IndexedDB only on load, never while typing", async () => {
    const readSpy = vi.spyOn(historyModule, "getRecentSearches");

    const { result } = renderHook(() => useSearchHistory({ limit: 100 }));
    await settle();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.recentSearches).toHaveLength(SEEDED_QUERIES.length);
    const readsAfterLoad = readSpy.mock.calls.length;
    expect(readsAfterLoad).toBe(1);

    for (const query of ["w", "we", "wet", "weth"]) {
      act(() => result.current.searchHistory(query));
      await settle();
    }

    expect(readSpy).toHaveBeenCalledTimes(readsAfterLoad);
    // The filter did run: the settled query produced matches from memory.
    expect(queriesOf(result.current.filteredSearches)).toContain(
      "weather in lisbon",
    );
  });

  it("re-scans all in-memory entries per settled query instead of narrowing", async () => {
    const { result } = renderHook(() => useSearchHistory({ limit: 100 }));
    await settle();

    // The trap: under this setup's per-length uFuzzy error rules, "wet"
    // compiles to a pattern that matches nothing.
    act(() => result.current.searchHistory("wet"));
    await settle();
    expect(queriesOf(result.current.filteredSearches)).not.toContain(
      "weather in lisbon",
    );

    // Typing past the prefix gains an insertion variant that matches. A fresh
    // full scan finds it; narrowing from the previous keystroke would have
    // kept it dropped forever.
    act(() => result.current.searchHistory("weth"));
    await settle();
    expect(queriesOf(result.current.filteredSearches)).toContain(
      "weather in lisbon",
    );
  });

  it("runs one fuzzy pass per settled query, not one per keystroke", async () => {
    const fuzzySpy = vi.spyOn(stringFormatters, "searchWithFuzzy");

    const { result } = renderHook(() => useSearchHistory({ limit: 100 }));
    await settle();
    expect(fuzzySpy).not.toHaveBeenCalled();

    // A burst of keystrokes with no quiet period: nothing filters yet.
    act(() => {
      result.current.searchHistory("w");
      result.current.searchHistory("we");
      result.current.searchHistory("wet");
      result.current.searchHistory("weth");
    });
    expect(fuzzySpy).not.toHaveBeenCalled();

    await settle();
    expect(fuzzySpy).toHaveBeenCalledTimes(1);
    expect(fuzzySpy.mock.calls[0][1]).toBe("weth");
  });

  it("keeps the 30s interval alive across keystrokes", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    const { result } = renderHook(() => useSearchHistory({ limit: 100 }));
    await settle();

    const intervalsAfterMount = setIntervalSpy.mock.calls.length;
    expect(intervalsAfterMount).toBe(1);

    for (const query of ["w", "we", "wet", "weth"]) {
      act(() => result.current.searchHistory(query));
      await settle();
    }

    expect(setIntervalSpy).toHaveBeenCalledTimes(intervalsAfterMount);
  });

  it("still refreshes from IndexedDB when the 30s interval fires", async () => {
    const readSpy = vi.spyOn(historyModule, "getRecentSearches");

    const { result } = renderHook(() => useSearchHistory({ limit: 100 }));
    await settle();
    expect(readSpy).toHaveBeenCalledTimes(1);

    act(() => result.current.searchHistory("weth"));
    await settle();
    expect(readSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + 50);
    });
    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  it("paginates from memory: page changes and queries trigger no reads", async () => {
    await addSearchToHistory("wine tasting porto", textResults);
    await addSearchToHistory("waterfall hike madeira", textResults);

    const readSpy = vi.spyOn(historyModule, "getRecentSearches");

    const { result } = renderHook(() =>
      useSearchHistory({ limit: 100, enablePagination: true, pageSize: 2 }),
    );
    await settle();

    expect(result.current.isLoading).toBe(false);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(result.current.filteredSearches).toHaveLength(2);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.hasNextPage).toBe(true);

    act(() => result.current.nextPage());
    await settle();
    expect(result.current.currentPage).toBe(1);
    expect(result.current.filteredSearches).toHaveLength(2);
    expect(readSpy).toHaveBeenCalledTimes(1);

    act(() => result.current.goToPage(0));
    await settle();

    act(() => result.current.searchHistory("w"));
    await settle();
    // Three of the five seeded queries fuzzy-match "w"; the page shows the
    // top-ranked two of them, counted over the full match set.
    const wMatches = [
      "weather in lisbon",
      "wine tasting porto",
      "waterfall hike madeira",
    ];
    expect(result.current.totalPages).toBe(2);
    expect(result.current.filteredSearches).toHaveLength(2);
    expect(wMatches).toEqual(
      expect.arrayContaining(queriesOf(result.current.filteredSearches)),
    );
    expect(readSpy).toHaveBeenCalledTimes(1);
  });
});
