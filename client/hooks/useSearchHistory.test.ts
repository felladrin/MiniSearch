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
    // Distinct, deterministic timestamps so the orderBy(timestamp).reverse()
    // read order never falls back to a tie resolved by Dexie internals.
    vi.advanceTimersByTime(1000);
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

    for (const query of ["w", "we", "wet", "weather"]) {
      act(() => result.current.searchHistory(query));
      await settle();
    }

    expect(readSpy).toHaveBeenCalledTimes(readsAfterLoad);
    // The filter did run: the settled query produced matches from memory.
    // "weather" is a stable prefix that always matches, so this test does not
    // depend on the uFuzzy narrowing trap.
    expect(queriesOf(result.current.filteredSearches)).toContain(
      "weather in lisbon",
    );
  });

  it("re-scans all in-memory entries per settled query instead of narrowing", async () => {
    // Assert the uFuzzy premise directly against the seeded entries first, so
    // a future @leeoniya/ufuzzy bump that changes the per-length error rules
    // fails here, pointing at the premise, not at the hook.
    const seeded = await historyDatabase.searches.toArray();
    expect(
      stringFormatters.searchWithFuzzy(seeded, "wet", (entry) => entry.query),
    ).toHaveLength(0);
    expect(
      queriesOf(
        stringFormatters
          .searchWithFuzzy(seeded, "weth", (entry) => entry.query)
          .map((result) => result.item),
      ),
    ).toContain("weather in lisbon");

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
    expect(result.current.filteredSearches).toHaveLength(1);
    expect(queriesOf(result.current.filteredSearches)).toContain(
      "weather in lisbon",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + 50);
    });
    expect(readSpy).toHaveBeenCalledTimes(2);
    // The active filter survives the background refresh: still one match,
    // not the full unfiltered list.
    expect(result.current.filteredSearches).toHaveLength(1);
    expect(queriesOf(result.current.filteredSearches)).toContain(
      "weather in lisbon",
    );
  });

  it("clearing the filter settles immediately, without waiting for the debounce", async () => {
    const { result } = renderHook(() => useSearchHistory({ limit: 100 }));
    await settle();

    act(() => result.current.searchHistory("weth"));
    await settle();
    expect(result.current.filteredSearches).toHaveLength(1);

    // The drawer's clear button: the full list must return on the same tick,
    // with no timer advance.
    act(() => result.current.searchHistory(""));
    expect(result.current.filteredSearches).toHaveLength(SEEDED_QUERIES.length);
  });

  it("paginates from memory: page changes and queries trigger no reads", async () => {
    await addSearchToHistory("wine tasting porto", textResults);
    vi.advanceTimersByTime(1000);
    await addSearchToHistory("waterfall hike madeira", textResults);
    vi.advanceTimersByTime(1000);

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
