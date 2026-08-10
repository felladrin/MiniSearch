import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import type { TextSearchResult } from "@/modules/types";
import { setReducedMotionPreference } from "../testUtils";
import SearchResultsList from "./SearchResultsList";

afterEach(() => {
  setReducedMotionPreference(false);
});

describe("SearchResultsList", () => {
  const mockResults: TextSearchResult[] = [
    ["First Title", "First snippet text", "https://example.com/first"],
    ["Second Title", "Second snippet text", "https://example.com/second"],
  ];
  // Mirrors the default `searchResultsLimit`, so a reintroduced per-index
  // stagger pushes the last result far past the timeouts asserted below.
  const manyResults: TextSearchResult[] = Array.from(
    { length: 15 },
    (_, index) => [
      `Result ${index + 1}`,
      `Snippet ${index + 1}`,
      `https://example.com/result-${index + 1}`,
    ],
  );
  const lastResultTitle = "Result 15";

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

  it("does not leave later results waiting behind a long stagger", async () => {
    render(
      <MantineProvider>
        <SearchResultsList searchResults={manyResults} />
      </MantineProvider>,
    );

    await waitFor(
      () => expect(screen.getByText(lastResultTitle)).toBeInTheDocument(),
      {
        timeout: 1000,
      },
    );
  });

  it("skips the animation when reduced motion is preferred", async () => {
    setReducedMotionPreference(true);

    render(
      <MantineProvider>
        <SearchResultsList searchResults={manyResults} />
      </MantineProvider>,
    );

    const resultTitle = await waitFor(() => screen.getByText(lastResultTitle), {
      timeout: 1000,
    });
    const resultStack = resultTitle.closest(".mantine-Stack-root");

    expect(resultStack).toBeInTheDocument();
    expect(resultStack?.getAttribute("style") ?? "").not.toContain(
      "transition",
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
