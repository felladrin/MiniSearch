import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import type { TextSearchResult } from "../../../../modules/types";
import SearchResultsList from "./SearchResultsList";

describe("SearchResultsList", () => {
  const mockResults: TextSearchResult[] = [
    ["First Title", "First snippet text", "https://example.com/first"],
    ["Second Title", "Second snippet text", "https://example.com/second"],
  ];

  it("renders a list of results after transition", async () => {
    render(
      <MantineProvider>
        <SearchResultsList searchResults={mockResults} />
      </MantineProvider>,
    );

    await waitFor(
      () => {
        mockResults.forEach(([title]) => {
          expect(screen.getByText(title)).toBeInTheDocument();
        });
      },
      { timeout: 2000 },
    );
  });

  it("renders snippets for each result", async () => {
    render(
      <MantineProvider>
        <SearchResultsList searchResults={mockResults} />
      </MantineProvider>,
    );

    await waitFor(
      () => {
        mockResults.forEach(([, snippet]) => {
          expect(screen.getByText(snippet)).toBeInTheDocument();
        });
      },
      { timeout: 2000 },
    );
  });

  it("renders links with correct href", async () => {
    render(
      <MantineProvider>
        <SearchResultsList searchResults={mockResults} />
      </MantineProvider>,
    );

    await waitFor(
      () => {
        mockResults.forEach(([title, , url]) => {
          const link = screen.getByRole("link", { name: title });
          expect(link).toHaveAttribute("href", url);
        });
      },
      { timeout: 2000 },
    );
  });

  it("renders empty list when no results", () => {
    render(
      <MantineProvider>
        <SearchResultsList searchResults={[]} />
      </MantineProvider>,
    );

    const stack = document.querySelector(".mantine-Stack-root");
    expect(stack).toBeInTheDocument();
    expect(stack?.children.length).toBe(0);
  });
});
