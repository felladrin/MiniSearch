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
  it("renders enable history switch", () => {
    render(
      <MantineProvider>
        <HistorySettings />
      </MantineProvider>,
    );

    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThanOrEqual(1);
    const enableSwitch = switches[0];
    expect(enableSwitch).toBeInTheDocument();
    expect(enableSwitch).toBeChecked();
  });

  it("renders switch label text", () => {
    render(
      <MantineProvider>
        <HistorySettings />
      </MantineProvider>,
    );

    expect(screen.getByText("Enable Search History")).toBeInTheDocument();
  });

  it("renders maximum entries input when history is enabled", () => {
    render(
      <MantineProvider>
        <HistorySettings />
      </MantineProvider>,
    );

    expect(screen.getByText("Maximum Entries")).toBeInTheDocument();
  });

  it("renders automatic cleanup switch when history is enabled", () => {
    render(
      <MantineProvider>
        <HistorySettings />
      </MantineProvider>,
    );

    expect(screen.getByText("Automatic Cleanup")).toBeInTheDocument();
  });

  it("renders clear history button", () => {
    render(
      <MantineProvider>
        <HistorySettings />
      </MantineProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Clear all history" }),
    ).toBeInTheDocument();
  });
});
