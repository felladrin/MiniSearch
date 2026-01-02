import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchForm from "@/components/Search/Form/SearchForm";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn((pubSub: unknown) => {
    if (!Array.isArray(pubSub)) {
      return [undefined, vi.fn()];
    }

    const maybeFactory = pubSub[2];
    if (typeof maybeFactory !== "function") {
      return [undefined, vi.fn()];
    }

    return [maybeFactory() ?? undefined, vi.fn()];
  }),
}));

vi.mock("wouter", () => ({
  useLocation: vi.fn(() => ["/", vi.fn()]),
}));

vi.mock("../../../hooks/useSearchHistory", () => ({
  useSearchHistory: vi.fn(() => ({
    addToHistory: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useHistoryRestore", () => ({
  useHistoryRestore: vi.fn(() => ({
    restoreSearch: vi.fn(),
  })),
}));

vi.mock("../History/HistoryButton", () => ({
  default: function HistoryButton() {
    return null;
  },
}));

vi.mock("../../../modules/textGeneration", () => ({
  searchAndRespond: vi.fn(),
}));

vi.mock("../../../modules/querySuggestions", () => ({
  getRandomQuerySuggestion: vi.fn(async () => "Anything you need!"),
}));

const renderSearchForm = (
  query: string,
  updateQuery: (query: string) => void,
) => {
  return render(
    <MantineProvider>
      <SearchForm query={query} updateQuery={updateQuery} />
    </MantineProvider>,
  );
};

const waitForPlaceholder = async () => {
  const textarea = await screen.findByRole("textbox");
  await waitFor(() => {
    expect(textarea).toHaveAttribute("placeholder", "Anything you need!");
  });
  return textarea;
};

describe("SearchForm component", () => {
  it("renders textarea with placeholder when empty", async () => {
    const mockUpdate = vi.fn();
    renderSearchForm("", mockUpdate);
    await waitForPlaceholder();
  });

  it("calls updateQuery on submit", async () => {
    const mockUpdate = vi.fn();
    const user = userEvent.setup();
    renderSearchForm("", mockUpdate);

    const textarea = await waitForPlaceholder();
    await user.type(textarea, "test query");
    const button = screen.getByRole("button", { name: /search/i });
    await user.click(button);

    expect(mockUpdate).toHaveBeenCalledWith("test query");
  });
});
