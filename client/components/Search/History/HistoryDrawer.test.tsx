import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePubSub } from "create-pubsub/react";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import type { SearchEntry } from "@/modules/history";
import HistoryDrawer from "./HistoryDrawer";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn(),
}));

vi.mock("@/hooks/useSearchHistory", () => ({
  useSearchHistory: vi.fn(),
}));

vi.mock("@/components/Analytics/SearchStats", () => ({
  default: function SearchStatsStub() {
    return <div>stats</div>;
  },
}));

function mockSettings(enableHistory: boolean) {
  vi.mocked(usePubSub).mockReturnValue([{ enableHistory }, vi.fn()]);
}

const renderDrawer = (
  onSearchSelect: (entry: SearchEntry) => void = vi.fn(),
) => {
  return render(
    <MantineProvider>
      <HistoryDrawer opened onClose={vi.fn()} onSearchSelect={onSearchSelect} />
    </MantineProvider>,
  );
};

const makeEntry = (id: number, query: string, pinned = false): SearchEntry => ({
  id,
  query,
  timestamp: Date.now(),
  pinned,
});

type SearchHistoryOverrides = {
  filteredSearches?: SearchEntry[];
  groupedSearches?: Record<string, SearchEntry[]>;
  togglePin?: (searchId: number) => Promise<void>;
  deleteEntry?: (searchId: number) => Promise<void>;
  searchHistory?: (query: string) => void;
};

/** The hook mock has to return the full shape the real hook returns. */
const mockHistory = (overrides: SearchHistoryOverrides = {}) => {
  const noop = vi.fn(async (): Promise<void> => {});
  vi.mocked(useSearchHistory).mockReturnValue({
    recentSearches: [],
    filteredSearches: overrides.filteredSearches ?? [],
    groupedSearches: overrides.groupedSearches ?? {},
    isLoading: false,
    error: null,
    currentPage: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
    retryLastOperation: noop,
    clearError: vi.fn(),
    searchHistory: overrides.searchHistory ?? vi.fn(),
    addToHistory: noop,
    togglePin: overrides.togglePin ?? noop,
    deleteEntry: overrides.deleteEntry ?? noop,
    clearAll: noop,
    refreshHistory: noop,
    nextPage: vi.fn(),
    previousPage: vi.fn(),
    goToPage: vi.fn(),
  });
};

describe("HistoryDrawer component", () => {
  beforeEach(() => {
    mockSettings(true);
    mockHistory({});
  });

  it("shows the disabled message when history is off", async () => {
    mockSettings(false);
    renderDrawer();
    expect(await screen.findByText("Search history is disabled")).toBeVisible();
  });

  it("shows the empty state when there is no history", async () => {
    renderDrawer();
    expect(await screen.findByText("No search history yet")).toBeVisible();
  });

  it("renders the seeded search entries", async () => {
    mockHistory({
      filteredSearches: [
        makeEntry(1, "quantum tunneling"),
        makeEntry(2, "sourdough starter"),
      ],
    });

    renderDrawer();
    expect(await screen.findByText("quantum tunneling")).toBeVisible();
    expect(screen.getByText("sourdough starter")).toBeVisible();
  });

  it("passes typed filter text to the history hook", async () => {
    const searchHistory = vi.fn();
    mockHistory({ searchHistory });

    const user = userEvent.setup();
    renderDrawer();
    const filterInput = await screen.findByPlaceholderText("Filter history...");
    await user.type(filterInput, "quantum");

    await waitFor(() => expect(searchHistory).toHaveBeenCalledWith("quantum"));
  });

  it("shows the no-matches message when a filter has no results", async () => {
    const user = userEvent.setup();
    renderDrawer();
    const filterInput = await screen.findByPlaceholderText("Filter history...");
    await user.type(filterInput, "quantum");

    expect(await screen.findByText("No matching searches found")).toBeVisible();
  });

  it("selects an entry when its card is clicked", async () => {
    const onSearchSelect = vi.fn();
    const entry = makeEntry(1, "quantum tunneling");
    mockHistory({ filteredSearches: [entry] });

    const user = userEvent.setup();
    renderDrawer(onSearchSelect);
    await user.click(await screen.findByText("quantum tunneling"));

    expect(onSearchSelect).toHaveBeenCalledWith(entry);
  });

  it("pins an entry without selecting it", async () => {
    const onSearchSelect = vi.fn();
    const entry = makeEntry(1, "quantum tunneling");
    const togglePin = vi.fn();
    mockHistory({ filteredSearches: [entry], togglePin });

    const user = userEvent.setup();
    renderDrawer(onSearchSelect);
    await screen.findByText("quantum tunneling");
    const pinButton = screen.getByRole("button", { name: "Pin search" });

    await user.click(pinButton);

    expect(togglePin).toHaveBeenCalledWith(1);
    expect(onSearchSelect).not.toHaveBeenCalled();
  });

  it("deletes an entry only after a confirming second click", async () => {
    const onSearchSelect = vi.fn();
    const entry = makeEntry(1, "quantum tunneling");
    const deleteEntry = vi.fn();
    mockHistory({ filteredSearches: [entry], deleteEntry });

    const user = userEvent.setup();
    renderDrawer(onSearchSelect);
    await screen.findByText("quantum tunneling");
    const deleteButton = screen.getByRole("button", { name: "Delete search" });

    await user.click(deleteButton);
    expect(deleteEntry).not.toHaveBeenCalled();
    // The delete button sits inside the selectable card. Without stopPropagation
    // every delete click would also run the entry as a search.
    expect(onSearchSelect).not.toHaveBeenCalled();

    const confirmButton = screen.getByRole("button", {
      name: "Click again to confirm delete",
    });
    await user.click(confirmButton);
    expect(deleteEntry).toHaveBeenCalledWith(1);
    expect(onSearchSelect).not.toHaveBeenCalled();
  });

  it("cancels the pending delete when the pointer leaves the button", async () => {
    const entry = makeEntry(1, "quantum tunneling");
    const deleteEntry = vi.fn();
    mockHistory({ filteredSearches: [entry], deleteEntry });

    const user = userEvent.setup();
    renderDrawer();
    await screen.findByText("quantum tunneling");

    await user.hover(screen.getByRole("button", { name: "Delete search" }));
    await user.click(screen.getByRole("button", { name: "Delete search" }));
    const armed = screen.getByRole("button", {
      name: "Click again to confirm delete",
    });
    expect(deleteEntry).not.toHaveBeenCalled();

    await user.unhover(armed);

    // Leaving reverts the button, so a later click arms the confirm again
    // instead of deleting on the first press.
    expect(
      screen.getByRole("button", { name: "Delete search" }),
    ).toBeInTheDocument();
    expect(deleteEntry).not.toHaveBeenCalled();

    await user.hover(screen.getByRole("button", { name: "Delete search" }));
    await user.click(screen.getByRole("button", { name: "Delete search" }));
    expect(deleteEntry).not.toHaveBeenCalled();
  });
});
