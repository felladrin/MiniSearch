import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchForm from "@/components/Search/Form/SearchForm";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn((pubSub: any) => [pubSub?.[2]?.() ?? undefined, vi.fn()]),
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

describe("SearchForm component", () => {
  it("renders textarea with placeholder when empty", async () => {
    const mockUpdate = vi.fn();
    render(
      <MantineProvider>
        <SearchForm query="" updateQuery={mockUpdate} />
      </MantineProvider>,
    );

    const textarea = await screen.findByRole("textbox");
    await waitFor(() => {
      expect(textarea).toHaveAttribute("placeholder", "Anything you need!");
    });
  });

  it("calls updateQuery on submit", async () => {
    const mockUpdate = vi.fn();
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <SearchForm query="" updateQuery={mockUpdate} />
      </MantineProvider>,
    );

    const textarea = await screen.findByRole("textbox");
    await waitFor(() => {
      expect(textarea).toHaveAttribute("placeholder", "Anything you need!");
    });
    await user.type(textarea, "test query");
    const button = screen.getByRole("button", { name: /search/i });
    await user.click(button);

    expect(mockUpdate).toHaveBeenCalledWith("test query");
  });
});
