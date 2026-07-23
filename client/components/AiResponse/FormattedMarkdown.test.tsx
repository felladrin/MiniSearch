import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FormattedMarkdown from "./FormattedMarkdown";

describe("FormattedMarkdown", () => {
  function renderComponent(component: React.ReactElement) {
    return render(<MantineProvider>{component}</MantineProvider>);
  }

  it("forwards aria-live and aria-busy to the Typography wrapper", () => {
    renderComponent(
      <FormattedMarkdown aria-live="polite" aria-busy={true}>
        Hello world
      </FormattedMarkdown>,
    );

    const typography = screen
      .getByText("Hello world")
      .closest("div[aria-live][aria-busy]");
    expect(typography).toHaveAttribute("aria-live", "polite");
    expect(typography).toHaveAttribute("aria-busy", "true");
  });

  it("omits aria attributes when not provided", () => {
    renderComponent(<FormattedMarkdown>Plain text</FormattedMarkdown>);

    const typography = screen.getByText("Plain text").closest("div");
    expect(typography).not.toHaveAttribute("aria-live");
    expect(typography).not.toHaveAttribute("aria-busy");
  });
});
