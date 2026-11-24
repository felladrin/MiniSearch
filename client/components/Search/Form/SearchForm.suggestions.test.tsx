import { MantineProvider } from "@mantine/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchForm from "@/components/Search/Form/SearchForm";
import { resetHandledQuery } from "@/modules/autoSearch";
import { getQuerySuggestions, updateQuerySuggestions } from "@/modules/pubSub";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/hooks/useSearchHistory", () => ({
  useSearchHistory: () => ({ addToHistory: vi.fn() }),
}));

vi.mock("@/hooks/useHistoryRestore", () => ({
  useHistoryRestore: () => ({ restoreSearch: vi.fn() }),
}));

vi.mock("../History/HistoryButton", () => ({ default: () => null }));

vi.mock("@/modules/textGeneration", () => ({ searchAndRespond: vi.fn() }));

vi.mock("@/components/DictationButton", () => ({
  dictationButtonWidth: 34,
  default: () => null,
}));

const storedSuggestions = Array.from(
  { length: 25 },
  (_, index) => `suggestion ${index}`,
);

function renderSearchForm(query: string) {
  render(
    <MantineProvider>
      <SearchForm query={query} updateQuery={vi.fn()} />
    </MantineProvider>,
  );
}

/** Lets the suggestion that an emptied field asks for finish arriving. */
const settle = () => act(async () => {});

describe("SearchForm and the stored suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHandledQuery();
    window.history.replaceState({}, "", "/");
    updateQuerySuggestions([...storedSuggestions]);
  });

  it("uses one stored suggestion when the last character is deleted", async () => {
    const user = userEvent.setup();
    renderSearchForm("a");

    await user.type(await screen.findByRole("textbox"), "{Backspace}");
    await settle();

    expect(getQuerySuggestions()).toHaveLength(24);
  });

  it("uses one stored suggestion when Clear is clicked", async () => {
    const user = userEvent.setup();
    renderSearchForm("hello");

    await user.click(await screen.findByRole("button", { name: "Clear" }));
    await settle();

    expect(getQuerySuggestions()).toHaveLength(24);
  });

  it("fetches the suggestions once when Clear finds the store empty", async () => {
    updateQuerySuggestions([]);
    mockFetch.mockImplementation(
      async () => new Response(JSON.stringify(["x", "y", "z"])),
    );
    const user = userEvent.setup();
    renderSearchForm("hello");

    await user.click(await screen.findByRole("button", { name: "Clear" }));
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getQuerySuggestions()).toHaveLength(2);
  });
});
