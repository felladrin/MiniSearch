import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import HistorySettings from "./HistorySettings";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn(() => [
    {
      enableHistory: true,
      historyMaxEntries: 500,
      historyAutoCleanup: true,
      historyRetentionDays: 30,
    },
    vi.fn(),
  ]),
}));

vi.mock("../../hooks/useSearchHistory", () => ({
  useSearchHistory: vi.fn(() => ({
    recentSearches: [],
    clearAll: vi.fn(),
  })),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

describe("HistorySettings component", () => {
  it("renders the history controls when history is enabled", () => {
    render(
      <MantineProvider>
        <HistorySettings />
      </MantineProvider>,
    );

    expect(screen.getByText("Enable Search History")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")[0]).toBeChecked();
    expect(screen.getByText("Maximum Entries")).toBeInTheDocument();
    expect(screen.getByText("Automatic Cleanup")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear all history" }),
    ).toBeInTheDocument();
  });
});
