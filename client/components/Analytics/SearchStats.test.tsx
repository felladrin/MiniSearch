import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import type { SearchEntry } from "@/modules/history";
import SearchStats from "./SearchStats";

vi.mock("@/hooks/useSearchHistory", () => ({
  useSearchHistory: vi.fn(),
}));

/** The hook mock has to return the full shape the real hook returns. */
const mockHistory = (recentSearches: SearchEntry[]) => {
  const noop = vi.fn(async (): Promise<void> => {});
  vi.mocked(useSearchHistory).mockReturnValue({
    recentSearches,
    llmResponseCount: 0,
    chatMessageCount: 0,
    filteredSearches: recentSearches,
    groupedSearches: {},
    isLoading: false,
    error: null,
    currentPage: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
    retryLastOperation: noop,
    clearError: vi.fn(),
    searchHistory: vi.fn(),
    addToHistory: noop,
    togglePin: noop,
    deleteEntry: noop,
    clearAll: noop,
    refreshHistory: noop,
    nextPage: vi.fn(),
    previousPage: vi.fn(),
    goToPage: vi.fn(),
  });
};

/** Metric cards print the value below the label; the heatmap above it. */
const valueBelow = (label: string) =>
  screen.getByText(label).nextElementSibling?.textContent;
const valueAbove = (label: string) =>
  screen.getByText(label).previousElementSibling?.textContent;

describe("SearchStats", () => {
  let originalTimeZone: string | undefined;

  beforeEach(() => {
    originalTimeZone = process.env.TZ;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  it("buckets the Daily Average by local day, like the heatmap", () => {
    process.env.TZ = "Europe/Zurich"; // UTC+1 in January
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 15, 12));

    // 00:30 and 01:30 local are 23:30 and 00:30 UTC: one local day, two UTC
    // days. The UTC check makes a silent no-op of the zone change fail loudly
    // instead of passing vacuously.
    const first = new Date(2026, 0, 15, 0, 30).getTime();
    const second = new Date(2026, 0, 15, 1, 30).getTime();
    expect(new Date(first).getUTCDate()).toBe(14);
    expect(new Date(second).getUTCDate()).toBe(15);

    mockHistory([
      { id: 1, query: "first", timestamp: first },
      { id: 2, query: "second", timestamp: second },
    ]);
    render(
      <MantineProvider>
        <SearchStats />
      </MantineProvider>,
    );

    expect(valueBelow("Daily Average")).toBe("2");
    expect(valueAbove("Active days")).toBe("1");
  });
});
