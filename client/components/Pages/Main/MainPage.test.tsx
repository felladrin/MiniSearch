import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePubSub } from "create-pubsub/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  imageSearchStatePubSub,
  queryPubSub,
  settingsPubSub,
  textGenerationStatePubSub,
  textSearchStatePubSub,
} from "@/modules/pubSub";
import { searchAndRespond } from "@/modules/textGeneration";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn(),
}));

vi.mock("@/components/Search/Form/SearchForm", () => ({
  default: () => <div data-testid="search-form" />,
}));

vi.mock("./Menu/MenuButton", () => ({
  default: () => <div data-testid="menu-button" />,
}));

vi.mock("@/components/AiResponse/AiResponseSection", () => ({
  default: () => <div data-testid="ai-response-section" />,
}));

vi.mock("@/components/Search/Results/SearchResultsSection", () => ({
  default: () => <div data-testid="search-results-section" />,
}));

vi.mock("@/components/AiResponse/EnableAiResponsePrompt", () => ({
  default: ({
    onAccept,
    onDecline,
  }: {
    onAccept: () => void;
    onDecline: () => void;
  }) => (
    <div data-testid="enable-ai-response-prompt">
      <button type="button" onClick={onAccept}>
        Accept
      </button>
      <button type="button" onClick={onDecline}>
        Decline
      </button>
    </div>
  ),
}));

vi.mock("@/modules/textGeneration", () => ({
  searchAndRespond: vi.fn(),
}));

interface PageState {
  query: string;
  textSearchState: string;
  imageSearchState: string;
  textGenerationState: string;
  settings: { showEnableAiResponsePrompt: boolean };
}

function createPageState(overrides: Partial<PageState> = {}): PageState {
  return {
    query: "",
    textSearchState: "idle",
    imageSearchState: "idle",
    textGenerationState: "idle",
    settings: { showEnableAiResponsePrompt: false },
    ...overrides,
  };
}

function mockPageState(state: PageState) {
  const updateQuery = vi.fn();
  const setSettings = vi.fn();

  vi.mocked(usePubSub).mockImplementation((pubSub: unknown) => {
    if (pubSub === queryPubSub) return [state.query, updateQuery];
    if (pubSub === textSearchStatePubSub)
      return [state.textSearchState, vi.fn()];
    if (pubSub === imageSearchStatePubSub)
      return [state.imageSearchState, vi.fn()];
    if (pubSub === textGenerationStatePubSub)
      return [state.textGenerationState, vi.fn()];
    if (pubSub === settingsPubSub) return [state.settings, setSettings];
    throw new Error("MainPage.test.tsx: unexpected pubSub in usePubSub mock");
  });

  return { updateQuery, setSettings };
}

async function renderMainPage(state: PageState) {
  const handlers = mockPageState(state);
  const MainPage = (await import("./MainPage")).default;
  const utils = render(
    <MantineProvider>
      <MainPage />
    </MantineProvider>,
  );
  return { ...utils, ...handlers };
}

describe("MainPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows only the search form when the query is empty", async () => {
    await renderMainPage(createPageState());

    expect(screen.getByTestId("search-form")).toBeInTheDocument();
    expect(
      screen.queryByTestId("search-results-section"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-response-section")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("enable-ai-response-prompt"),
    ).not.toBeInTheDocument();
  });

  it("shows search results once a search is underway and the query is non-empty", async () => {
    await renderMainPage(
      createPageState({ query: "cats", textSearchState: "loading" }),
    );

    expect(
      await screen.findByTestId("search-results-section"),
    ).toBeInTheDocument();
  });

  it("does not show search results while the query is empty, even mid-search", async () => {
    await renderMainPage(
      createPageState({ query: "", textSearchState: "loading" }),
    );

    expect(
      screen.queryByTestId("search-results-section"),
    ).not.toBeInTheDocument();
  });

  it("shows the AI response section once text generation starts", async () => {
    await renderMainPage(
      createPageState({ query: "cats", textGenerationState: "generating" }),
    );

    expect(
      await screen.findByTestId("ai-response-section"),
    ).toBeInTheDocument();
  });

  it("shows the enable-AI-response prompt instead of the AI response section when configured", async () => {
    await renderMainPage(
      createPageState({
        query: "cats",
        textGenerationState: "generating",
        settings: { showEnableAiResponsePrompt: true },
      }),
    );

    expect(
      await screen.findByTestId("enable-ai-response-prompt"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ai-response-section")).not.toBeInTheDocument();
  });

  it("enables AI response and triggers a search when the prompt is accepted", async () => {
    const user = userEvent.setup();
    const { setSettings } = await renderMainPage(
      createPageState({
        query: "cats",
        settings: { showEnableAiResponsePrompt: true },
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Accept" }));

    expect(setSettings).toHaveBeenCalledWith({
      showEnableAiResponsePrompt: false,
      enableAiResponse: true,
    });
    expect(searchAndRespond).toHaveBeenCalled();
  });

  it("disables AI response without triggering a search when the prompt is declined", async () => {
    const user = userEvent.setup();
    const { setSettings } = await renderMainPage(
      createPageState({
        query: "cats",
        settings: { showEnableAiResponsePrompt: true },
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Decline" }));

    expect(setSettings).toHaveBeenCalledWith({
      showEnableAiResponsePrompt: false,
      enableAiResponse: false,
    });
    expect(searchAndRespond).not.toHaveBeenCalled();
  });
});
