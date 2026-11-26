import { MantineProvider } from "@mantine/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchForm from "@/components/Search/Form/SearchForm";
import { resetHandledQuery } from "@/modules/autoSearch";
import type { SearchEntry } from "@/modules/history";
import {
  isRestoringFromHistoryPubSub,
  updateResponse,
  updateTextSearchResults,
  updateTextSearchState,
} from "@/modules/pubSub";
import { sleep } from "@/modules/sleep";
import { cancelSearchAnswer, searchAndRespond } from "@/modules/textGeneration";

const addToHistory = vi.fn();
const navigate = vi.fn((path: string) => {
  window.history.replaceState({}, "", path);
});

/** The entry the history button hands to `restoreSearch` when clicked. */
let entryToRestore: SearchEntry = { query: "", timestamp: 0 };

vi.mock("wouter", () => ({
  useLocation: () => ["/", navigate],
}));

vi.mock("@/hooks/useSearchHistory", () => ({
  useSearchHistory: () => ({ addToHistory }),
}));

vi.mock("../History/HistoryButton", () => ({
  default: function HistoryButton({
    onSearchSelect,
  }: {
    onSearchSelect: (entry: SearchEntry) => void;
  }) {
    return (
      <button type="button" onClick={() => onSearchSelect(entryToRestore)}>
        Restore
      </button>
    );
  },
}));

vi.mock("@/modules/textGeneration", () => ({
  cancelSearchAnswer: vi.fn(),
  searchAndRespond: vi.fn(),
}));

vi.mock("@/modules/querySuggestions", () => ({
  DEFAULT_QUERY_SUGGESTION: "Anything you need!",
  getRandomQuerySuggestion: vi.fn(async () => "Anything you need!"),
}));

vi.mock("@/modules/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/history")>()),
  getLatestLlmResponseForEntry: vi.fn().mockResolvedValue(null),
  getChatMessagesForQuery: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/DictationButton", () => ({
  dictationButtonWidth: 34,
  default: () => null,
}));

function renderSearchForm(query = "") {
  const updateQuery = vi.fn();
  render(
    <MantineProvider>
      <SearchForm query={query} updateQuery={updateQuery} />
    </MantineProvider>,
  );
  return updateQuery;
}

/**
 * Clicks the history button, waits for the restore to finish and flushes the
 * `sleepUntilIdle` tick the auto-search effect takes before acting.
 */
async function restore(entry: SearchEntry) {
  entryToRestore = entry;
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(isRestoringFromHistoryPubSub[2]()).toBe(false));
  await act(() => sleep(0));
}

describe("SearchForm with the real history restore", () => {
  beforeEach(() => {
    addToHistory.mockClear();
    navigate.mockClear();
    vi.mocked(searchAndRespond).mockClear();
    resetHandledQuery();
    updateTextSearchResults([]);
    updateTextSearchState("idle");
    updateResponse("");
    window.history.replaceState({}, "", "/");
  });

  it("does not add a history entry or search when an empty entry is restored", async () => {
    renderSearchForm();
    await screen.findByRole("textbox");

    await restore({ query: "failed search", timestamp: 1 });

    expect(window.location.search).toBe("?q=failed%20search");
    expect(screen.getByRole("textbox")).toHaveValue("failed search");
    expect(addToHistory).not.toHaveBeenCalled();
    expect(searchAndRespond).not.toHaveBeenCalled();
  });

  it("cancels the live answer before restoring an entry", async () => {
    renderSearchForm();
    await screen.findByRole("textbox");
    vi.mocked(cancelSearchAnswer).mockClear();

    await restore({ query: "earlier search", timestamp: 2 });

    expect(cancelSearchAnswer).toHaveBeenCalledOnce();
  });

  it("does not re-run the auto-search when results and response are cleared after a restore", async () => {
    renderSearchForm();
    await screen.findByRole("textbox");
    await restore({
      query: "saved search",
      timestamp: 1,
      textResults: {
        type: "text",
        items: [{ title: "Saved", snippet: "Saved", url: "https://e.com" }],
      },
    });

    // Regenerate and "enable AI response" start by clearing the response and
    // the results while the URL still holds the restored query.
    act(() => {
      updateResponse("");
      updateTextSearchResults([]);
    });
    await act(() => sleep(0));

    expect(addToHistory).not.toHaveBeenCalled();
    expect(searchAndRespond).not.toHaveBeenCalled();
  });

  it("still adds one entry and runs one search when the restored query is submitted", async () => {
    renderSearchForm();
    await screen.findByRole("textbox");
    await restore({ query: "failed search", timestamp: 1 });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() => expect(searchAndRespond).toHaveBeenCalledTimes(1));

    expect(addToHistory).toHaveBeenCalledTimes(1);
    expect(addToHistory).toHaveBeenCalledWith("failed search", {
      type: "text",
      items: [],
    });
  });

  it("still auto-searches a fresh URL query once", async () => {
    window.history.replaceState({}, "", "/?q=fresh+load");
    renderSearchForm("fresh load");

    await waitFor(() => expect(searchAndRespond).toHaveBeenCalledTimes(1));
    expect(addToHistory).toHaveBeenCalledTimes(1);
  });
});
