import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn(() => [
    {
      enableTextSearch: true,
      enableImageSearch: true,
    },
    vi.fn(),
  ]),
}));

vi.mock("./Graphical/ImageSearchResults", () => ({
  default: () => <div data-testid="image-search-results">Image Results</div>,
}));

vi.mock("./Textual/TextSearchResults", () => ({
  default: () => <div data-testid="text-search-results">Text Results</div>,
}));

vi.mock(
  "../client/components/Search/Results/Textual/TextSearchResults",
  () => ({
    default: () => <div data-testid="text-search-results">Text Results</div>,
  }),
);

describe("SearchResultsSection component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders both image and text search results when enabled", async () => {
    const SearchResultsSection = (await import("./SearchResultsSection"))
      .default;

    render(
      <MantineProvider>
        <SearchResultsSection />
      </MantineProvider>,
    );

    expect(screen.getByTestId("image-search-results")).toBeInTheDocument();
    expect(screen.getByTestId("text-search-results")).toBeInTheDocument();
  });

  it("renders only text search when image search is disabled", async () => {
    const { usePubSub } = await import("create-pubsub/react");
    vi.mocked(usePubSub).mockReturnValue([
      {
        enableTextSearch: true,
        enableImageSearch: false,
      },
      vi.fn(),
    ]);

    const SearchResultsSection = (await import("./SearchResultsSection"))
      .default;

    render(
      <MantineProvider>
        <SearchResultsSection />
      </MantineProvider>,
    );

    expect(
      screen.queryByTestId("image-search-results"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("text-search-results")).toBeInTheDocument();
  });

  it("renders only image search when text search is disabled", async () => {
    const { usePubSub } = await import("create-pubsub/react");
    vi.mocked(usePubSub).mockReturnValue([
      {
        enableTextSearch: false,
        enableImageSearch: true,
      },
      vi.fn(),
    ]);

    const SearchResultsSection = (await import("./SearchResultsSection"))
      .default;

    render(
      <MantineProvider>
        <SearchResultsSection />
      </MantineProvider>,
    );

    expect(screen.getByTestId("image-search-results")).toBeInTheDocument();
    expect(screen.queryByTestId("text-search-results")).not.toBeInTheDocument();
  });

  it("renders nothing when both searches are disabled", async () => {
    const { usePubSub } = await import("create-pubsub/react");
    vi.mocked(usePubSub).mockReturnValue([
      {
        enableTextSearch: false,
        enableImageSearch: false,
      },
      vi.fn(),
    ]);

    const SearchResultsSection = (await import("./SearchResultsSection"))
      .default;

    render(
      <MantineProvider>
        <SearchResultsSection />
      </MantineProvider>,
    );

    expect(
      screen.queryByTestId("image-search-results"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-search-results")).not.toBeInTheDocument();
  });

  it("wraps components in error boundary", async () => {
    const SearchResultsSection = (await import("./SearchResultsSection"))
      .default;

    const { container } = render(
      <MantineProvider>
        <SearchResultsSection />
      </MantineProvider>,
    );

    expect(container.querySelector(".mantine-Stack-root")).toBeInTheDocument();
  });
});
