import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { useSearchHistory } from "../../hooks/useSearchHistory";
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
  useSearchHistory: vi.fn(),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

const mockedUseSearchHistory = vi.mocked(useSearchHistory);

function mockHistory(
  overrides: {
    recentSearches?: unknown[];
    llmResponseCount?: number;
    chatMessageCount?: number;
  } = {},
) {
  mockedUseSearchHistory.mockReturnValue({
    recentSearches: [],
    llmResponseCount: 0,
    chatMessageCount: 0,
    clearAll: vi.fn(),
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: partial hook mock for component tests
  } as any);
}

function renderSettings() {
  return render(
    <MantineProvider>
      <HistorySettings />
    </MantineProvider>,
  );
}

describe("HistorySettings component", () => {
  beforeEach(() => {
    mockHistory();
  });

  it("renders the history controls when history is enabled", () => {
    renderSettings();

    expect(
      screen.getByRole("switch", { name: /Enable Search History/ }),
    ).toBeChecked();
    expect(screen.getByText("Maximum Entries")).toBeInTheDocument();
    expect(screen.getByText("Automatic Cleanup")).toBeInTheDocument();
    // Behind the auto-cleanup switch, which the mock leaves on.
    expect(screen.getByText("Retention Days")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear all history" }),
    ).toBeInTheDocument();
  });

  it("disables the clear button only when all three history tables are empty", () => {
    mockHistory({
      recentSearches: [],
      llmResponseCount: 0,
      chatMessageCount: 0,
    });
    renderSettings();

    expect(
      screen.getByRole("button", { name: "Clear all history" }),
    ).toBeDisabled();
  });

  it("keeps the clear button enabled when only stored AI responses remain", () => {
    // searches is empty (e.g. cleared before the three-table clear-all landed),
    // but AI responses are still in IndexedDB and must stay reachable.
    mockHistory({
      recentSearches: [],
      llmResponseCount: 2,
      chatMessageCount: 0,
    });
    renderSettings();

    expect(
      screen.getByRole("button", { name: "Clear all history" }),
    ).toBeEnabled();
  });

  it("keeps the clear button enabled when only stored chat messages remain", () => {
    mockHistory({
      recentSearches: [],
      llmResponseCount: 0,
      chatMessageCount: 5,
    });
    renderSettings();

    expect(
      screen.getByRole("button", { name: "Clear all history" }),
    ).toBeEnabled();
  });

  it("confirmation text names searches, AI responses and chat messages", async () => {
    mockHistory({ recentSearches: [{ id: 1 }], llmResponseCount: 1 });
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Clear all history" }));

    // Mantine's Modal mounts its content on a transition, so wait for it.
    expect(
      await screen.findByText(
        /permanently delete all your saved searches, AI responses and chat messages/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/search entries/i)).not.toBeInTheDocument();
  });
});
