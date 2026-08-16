import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { usePubSub } from "create-pubsub/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsPubSub } from "@/modules/pubSub";
import { getQuerySuggestionSamples } from "@/modules/querySuggestions";
import HomePage from "./HomePage";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn(),
}));

vi.mock("@/components/Search/Form/SearchForm", () => ({
  default: () => <div data-testid="search-form" />,
}));

vi.mock("./Menu/MenuButton", () => ({
  default: () => <div data-testid="menu-button" />,
}));

vi.mock("@/hooks/useSearchHistory", () => ({
  useSearchHistory: vi.fn().mockReturnValue({ recentSearches: [] }),
}));

vi.mock("@/modules/querySuggestions", () => ({
  getQuerySuggestionSamples: vi.fn(),
}));

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePubSub).mockImplementation((pubSub: unknown) => {
      if (pubSub === settingsPubSub)
        return [
          {
            enableHistory: true,
          },
          vi.fn(),
        ];
      throw new Error("unexpected pubSub");
    });
  });

  it("shows the brand and the search form", () => {
    vi.mocked(getQuerySuggestionSamples).mockResolvedValue([]);
    render(
      <MantineProvider>
        <HomePage query="" updateQuery={vi.fn()} />
      </MantineProvider>,
    );

    expect(screen.getByText("MiniSearch")).toBeInTheDocument();
    expect(
      screen.getByText("Private AI search in your browser"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("search-form")).toBeInTheDocument();
  });

  it("shows suggestion chips that link to a fresh search", async () => {
    vi.mocked(getQuerySuggestionSamples).mockResolvedValue([
      "Why do we yawn?",
      "How do rockets work?",
      "How do magnets work?",
    ]);
    render(
      <MantineProvider>
        <HomePage query="" updateQuery={vi.fn()} />
      </MantineProvider>,
    );

    const link = await screen.findByRole("link", { name: "Why do we yawn?" });
    expect(link).toHaveAttribute("href", "/?q=Why%20do%20we%20yawn%3F");
    expect(
      screen.getByRole("link", { name: "How do rockets work?" }),
    ).toHaveAttribute("href", "/?q=How%20do%20rockets%20work%3F");
  });

  it("shows recent searches as links", async () => {
    vi.mocked(getQuerySuggestionSamples).mockResolvedValue([]);
    const { useSearchHistory } = await import("@/hooks/useSearchHistory");
    vi.mocked(useSearchHistory).mockReturnValue({
      recentSearches: [
        { id: 1, query: "quantum computing", timestamp: Date.now() },
        { id: 2, query: "pasta recipe", timestamp: Date.now() },
      ],
    } as never);

    render(
      <MantineProvider>
        <HomePage query="" updateQuery={vi.fn()} />
      </MantineProvider>,
    );

    const link = await screen.findByRole("link", { name: "quantum computing" });
    expect(link).toHaveAttribute("href", "/?q=quantum%20computing");
  });
});
