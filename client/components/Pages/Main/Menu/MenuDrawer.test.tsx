import { MantineProvider } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
import { usePubSub } from "create-pubsub/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { menuExpandedAccordionsPubSub } from "@/modules/pubSub";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn(),
}));

vi.mock("./AISettings/AISettingsForm", () => ({
  default: () => <div data-testid="ai-settings-form" />,
}));

vi.mock("./SearchSettingsForm", () => ({
  default: () => <div data-testid="search-settings-form" />,
}));

vi.mock("./InterfaceSettingsForm", () => ({
  default: () => <div data-testid="interface-settings-form" />,
}));

vi.mock("./VoiceSettingsForm", () => ({
  default: () => <div data-testid="voice-settings-form" />,
}));

vi.mock("./ActionsForm", () => ({
  default: () => <div data-testid="actions-form" />,
}));

vi.mock("@/components/Settings/HistorySettings", () => ({
  default: () => <div data-testid="history-settings-form" />,
}));

interface MenuState {
  expandedAccordions: string[];
}

function createMenuState(overrides: Partial<MenuState> = {}): MenuState {
  return {
    expandedAccordions: [],
    ...overrides,
  };
}

function mockMenuState(state: MenuState) {
  vi.mocked(usePubSub).mockImplementation((pubSub: unknown) => {
    if (pubSub === menuExpandedAccordionsPubSub)
      return [state.expandedAccordions, vi.fn()];
    throw new Error("MenuDrawer.test.tsx: unexpected pubSub in usePubSub mock");
  });
}

async function renderMenuDrawer(state: MenuState) {
  mockMenuState(state);
  const MenuDrawer = (await import("./MenuDrawer")).default;
  const utils = render(
    <MantineProvider>
      <MenuDrawer opened onClose={vi.fn()} />
    </MantineProvider>,
  );
  return utils;
}

describe("MenuDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a description under each accordion control", async () => {
    await renderMenuDrawer(createMenuState());

    const sections: Array<[title: string, description: string]> = [
      ["AI Settings", "AI responses, where inference runs, and reasoning"],
      ["Search Settings", "Text and image results, and how many to show"],
      ["Interface Settings", "Appearance and search-box input"],
      ["History Settings", "How long and how many searches to keep"],
      ["Voice Settings", "The voice used when reading answers aloud"],
      ["Actions", "Clear stored data and view the log"],
    ];

    // Scoped to the control so the test fails if a description moves into the
    // (keepMounted) panel, where it would no longer be visible while collapsed.
    for (const [title, description] of sections) {
      const control = screen.getByRole("button", { name: new RegExp(title) });
      expect(within(control).getByText(description)).toBeInTheDocument();
    }
  });
});
