import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import type { TextSearchResult } from "@/modules/types";
import {
  resetReducedMotionPreference,
  setReducedMotionPreference,
} from "../testUtils";
import SearchResultsList from "./SearchResultsList";

afterEach(() => {
  resetReducedMotionPreference();
});

describe("SearchResultsList", () => {
  const mockResults: TextSearchResult[] = [
    ["First Title", "First snippet text", "https://example.com/first"],
    ["Second Title", "Second snippet text", "https://example.com/second"],
  ];
  const manyResults: TextSearchResult[] = Array.from(
    { length: 6 },
    (_, index) => [
      `Result ${index + 1}`,
      `Snippet ${index + 1}`,
      `https://example.com/result-${index + 1}`,
    ],
  );

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
      () => expect(screen.getByText("Result 6")).toBeInTheDocument(),
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

    const resultTitle = await waitFor(() => screen.getByText("Result 6"), {
      timeout: 1000,
    });
    const resultStyle = resultTitle
      .closest(".mantine-Stack-root")
      ?.getAttribute("style");

    expect(resultStyle ?? "").not.toContain("transition-property");
    expect(resultStyle ?? "").not.toContain("transition-duration");
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
