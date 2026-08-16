import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "./HomePage";

vi.mock("@/components/Search/Form/SearchForm", () => ({
  default: () => <div data-testid="search-form" />,
}));

describe("HomePage", () => {
  it("renders the search form", () => {
    render(
      <MantineProvider>
        <HomePage query="" updateQuery={vi.fn()} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("search-form")).toBeInTheDocument();
  });
});
