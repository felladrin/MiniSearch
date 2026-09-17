import { MantineProvider } from "@mantine/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import AiModelDownloadAllowanceContent from "@/components/AiResponse/AiModelDownloadAllowanceContent";
import { saveLlmResponseForQuery } from "./history";
import {
  getSettings,
  getTextGenerationState,
  listenToSettingsChanges,
  queryPubSub,
  settingsPubSub,
  updateTextGenerationState,
} from "./pubSub";
import { defaultSettings } from "./settings";
import { searchAndRespond } from "./textGeneration";
import { generateTextWithWllama } from "./textGenerationWithWllama";

const observedListeners = vi.hoisted(
  () =>
    [] as {
      callback: Mock<Parameters<typeof listenToSettingsChanges>[0]>;
      unsubscribe: Mock<() => void>;
    }[],
);

vi.mock("./pubSub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pubSub")>();
  return {
    ...actual,
    listenToSettingsChanges: vi.fn(
      (...args: Parameters<typeof actual.listenToSettingsChanges>) => {
        const callback = vi.fn(args[0]);
        const unsubscribe = vi.fn(actual.listenToSettingsChanges(callback));
        observedListeners.push({ callback, unsubscribe });
        return unsubscribe;
      },
    ),
  };
});

vi.mock("./history", () => ({
  getCurrentSearchRunId: vi.fn(() => "permission-test"),
  saveLlmResponseForQuery: vi.fn().mockResolvedValue(undefined),
  updateSearchResults: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./search", () => ({
  searchText: vi.fn().mockResolvedValue({
    results: [["Fixture", "Search result", "https://example.com"]],
    stale: false,
  }),
  searchImages: vi.fn().mockResolvedValue({ results: [], stale: false }),
}));

vi.mock("./textGenerationWithWllama", () => ({
  generateTextWithWllama: vi.fn().mockResolvedValue(undefined),
  generateChatWithWllama: vi.fn(),
}));

describe("model-download permission lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observedListeners.length = 0;
    settingsPubSub[0]({
      ...defaultSettings,
      inferenceType: "browser",
      enableAiResponse: true,
      enableImageSearch: false,
      enablePageContentFetch: false,
    });
    queryPubSub[0]("Permission test");
    updateTextGenerationState("idle");
  });

  afterEach(() => {
    cleanup();
    for (const { unsubscribe } of observedListeners) unsubscribe();
  });

  it("continues without subscribing when downloads are already allowed", async () => {
    settingsPubSub[0]({ ...getSettings(), allowAiModelDownload: true });

    await searchAndRespond();

    expect(listenToSettingsChanges).not.toHaveBeenCalled();
    expect(generateTextWithWllama).toHaveBeenCalledOnce();
    expect(getTextGenerationState()).toBe("completed");
  });

  it("unsubscribes before continuing after the user allows a download", async () => {
    const generation = searchAndRespond();
    const { callback, unsubscribe } = observedListeners[0];
    render(
      <MantineProvider>
        <AiModelDownloadAllowanceContent />
      </MantineProvider>,
    );

    expect(getTextGenerationState()).toBe("awaitingModelDownloadAllowance");
    expect(generateTextWithWllama).not.toHaveBeenCalled();
    act(() => settingsPubSub[0]({ ...getSettings(), searchResultsLimit: 7 }));
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(generateTextWithWllama).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Allow download" }),
    );
    await generation;

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(generateTextWithWllama).mock.invocationCallOrder[0],
    );
    expect(generateTextWithWllama).toHaveBeenCalledOnce();
    expect(saveLlmResponseForQuery).toHaveBeenCalledOnce();
    expect(getTextGenerationState()).toBe("completed");
    const calls = callback.mock.calls.length;
    act(() => settingsPubSub[0]({ ...getSettings(), searchResultsLimit: 8 }));
    expect(callback).toHaveBeenCalledTimes(calls);
  });

  it("removes each completed wait across repeated permission requests", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      settingsPubSub[0]({ ...getSettings(), allowAiModelDownload: false });
      const generation = searchAndRespond();
      expect(getTextGenerationState()).toBe("awaitingModelDownloadAllowance");
      settingsPubSub[0]({ ...getSettings(), allowAiModelDownload: true });
      await generation;
      expect(observedListeners[attempt].unsubscribe).toHaveBeenCalledOnce();
    }

    settingsPubSub[0]({ ...getSettings(), searchResultsLimit: 9 });
    for (const { callback, unsubscribe } of observedListeners) {
      expect(callback).toHaveBeenCalledOnce();
      expect(unsubscribe).toHaveBeenCalledOnce();
    }
    expect(generateTextWithWllama).toHaveBeenCalledTimes(3);
  });
});
