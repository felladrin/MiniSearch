import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  historyMock,
  logEntriesMock,
  notificationsMock,
  pubSubMock,
  searchMock,
} from "./textGenerationTestUtils";

vi.mock("./pubSub", () =>
  pubSubMock(() => ({
    inferenceType: "browser",
    enableAiResponse: true,
    enableTextSearch: true,
    enableImageSearch: true,
    searchResultsLimit: 10,
    allowAiModelDownload: true,
  })),
);
vi.mock("./history", () => historyMock(() => "run-1"));
vi.mock("./logEntries", () => logEntriesMock());
vi.mock("./notifications", () => notificationsMock());
vi.mock("./search", () => searchMock());
vi.mock("./systemPrompt", () => ({ getSystemPrompt: vi.fn(() => "") }));
vi.mock("./textGenerationUtilities", () => ({
  ChatGenerationError: class ChatGenerationError extends Error {},
  defaultContextSize: 4096,
  getFormattedSearchResults: vi.fn(() => ""),
  searchResultsToConsider: 6,
  withoutReasoning: (messages: unknown) => messages,
}));
vi.mock("gpt-tokenizer", () => ({
  default: { encode: vi.fn(() => [1, 2, 3]) },
}));
vi.mock("pretty-ms", () => ({
  default: vi.fn(() => "100ms"),
}));
vi.mock("./textGenerationWithWllama", () => ({
  generateTextWithWllama: vi.fn(() => Promise.resolve()),
  generateChatWithWllama: vi.fn(() => Promise.resolve("")),
}));

import gptTokenizer from "gpt-tokenizer";
import {
  getCurrentSearchRunId,
  replaceChatConversation,
  saveLlmResponseForQuery,
} from "./history";
import {
  getQuery,
  getSettings,
  listenToSettingsChanges,
  updateResponseImmediately,
  updateTextGenerationState,
} from "./pubSub";
import { getLatestSearchAttempt } from "./searchAttempts";
import {
  cancelSearchAnswer,
  generateReplyToMessages,
  interruptSearch,
  searchAndRespond,
  textGenerationFunctions,
} from "./textGeneration";
import {
  generateChatWithWllama,
  generateTextWithWllama,
} from "./textGenerationWithWllama";

const mockGetSettings = vi.mocked(getSettings);

describe("needsModelDownloadGate", () => {
  // Only the in-browser backend downloads a model, and an unknown backend from
  // an older stored profile falls back to it.
  it.each([
    ["browser", true],
    ["openai", false],
    ["horde", false],
    ["internal", false],
    ["unknown-legacy-type", true],
  ])("gates the %s inference type: %s", (inferenceType, expected) => {
    mockGetSettings.mockReturnValueOnce({ inferenceType } as never);

    expect(textGenerationFunctions.needsModelDownloadGate()).toBe(expected);
  });
});

describe("generateReplyToMessages", () => {
  it("drops the oldest messages that do not fit the context, starting on a user message", async () => {
    vi.mocked(gptTokenizer.encode).mockImplementation((text: string) =>
      Array.from(text, () => 1),
    );

    try {
      await generateReplyToMessages([
        { role: "user", content: "x".repeat(4000) },
        { role: "assistant", content: "ok" },
        { role: "user", content: "question" },
      ]);
    } finally {
      vi.mocked(gptTokenizer.encode).mockImplementation(() => [1, 2, 3]);
    }

    expect(generateChatWithWllama).toHaveBeenCalledWith(
      [{ role: "user", content: "question" }],
      expect.any(Function),
      undefined,
    );
  });
});

describe("searchAndRespond", () => {
  it("cancels the previous search's answer, and Stop cancels the current one", async () => {
    vi.mocked(getQuery).mockReturnValue("question");
    mockGetSettings.mockReturnValue({
      inferenceType: "browser",
      enableAiResponse: true,
      enableTextSearch: false,
      enableImageSearch: false,
      allowAiModelDownload: true,
    } as never);
    const signals: AbortSignal[] = [];
    vi.mocked(generateTextWithWllama).mockImplementation(
      (signal) =>
        new Promise((_resolve, reject) => {
          if (!signal) throw new Error("no signal");
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const first = searchAndRespond();
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const second = searchAndRespond();
    await vi.waitFor(() => expect(signals).toHaveLength(2));

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    interruptSearch();
    await Promise.all([first, second]);

    expect(signals[1].aborted).toBe(true);
    expect(updateTextGenerationState).toHaveBeenCalledWith("interrupted");
    expect(updateTextGenerationState).not.toHaveBeenCalledWith("failed");
  });

  it("leaves no stuck state when a search with AI off replaces a running answer", async () => {
    vi.mocked(getQuery).mockReturnValue("question");
    const settings = {
      inferenceType: "browser",
      enableAiResponse: true,
      enableTextSearch: false,
      enableImageSearch: false,
      allowAiModelDownload: true,
    };
    mockGetSettings.mockImplementation(() => settings as never);
    let running: AbortSignal | undefined;
    vi.mocked(generateTextWithWllama).mockImplementation(
      (signal) =>
        new Promise((_resolve, reject) => {
          running = signal;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const first = searchAndRespond();
    await vi.waitFor(() => expect(running).toBeDefined());
    vi.mocked(updateTextGenerationState).mockClear();
    settings.enableAiResponse = false;
    await searchAndRespond();
    await first;

    expect(running?.aborted).toBe(true);
    expect(updateTextGenerationState).toHaveBeenLastCalledWith("idle");
  });
});

describe("answers that return after their search was replaced", () => {
  /** Engine calls the test resolves by hand, even after an abort. */
  let finish: Array<(answer: string) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    finish = [];
    mockGetSettings.mockReturnValue({
      inferenceType: "browser",
      enableAiResponse: true,
      enableTextSearch: false,
      enableImageSearch: false,
      allowAiModelDownload: true,
    } as never);
    vi.mocked(generateTextWithWllama).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(resolve);
        }),
    );
  });

  function startSearch(query: string, searchRunId: string) {
    vi.mocked(getQuery).mockReturnValue(query);
    vi.mocked(getCurrentSearchRunId).mockReturnValue(searchRunId);
    return searchAndRespond();
  }

  it("clears the run's stored follow-ups once the new answer is saved", async () => {
    const running = startSearch("A", "run-a");
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    expect(replaceChatConversation).not.toHaveBeenCalled();

    finish[0]("answer A");
    await running;

    expect(replaceChatConversation).toHaveBeenCalledWith("run-a", []);
  });

  it("keeps the stored follow-ups when the regenerated answer is stopped", async () => {
    const running = startSearch("A", "run-a");
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    interruptSearch();
    finish[0]("partial answer");
    await running;

    expect(replaceChatConversation).not.toHaveBeenCalled();
  });

  it("records the new attempt before the chat can unmount", async () => {
    const before = getLatestSearchAttempt("run-a");
    const running = startSearch("A", "run-a");

    // Synchronous: a follow-up that commits after this tick sees the change.
    expect(getLatestSearchAttempt("run-a")).not.toBe(before);
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    finish[0]("answer A");
    await running;
  });

  it("saves and shows only the newer search's answer", async () => {
    const first = startSearch("A", "run-a");
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    const second = startSearch("B", "run-b");
    await vi.waitFor(() => expect(finish).toHaveLength(2));

    finish[1]("answer B");
    await second;
    const stateWritesAfterB = vi.mocked(updateTextGenerationState).mock.calls
      .length;
    finish[0]("answer A");
    await first;

    expect(saveLlmResponseForQuery).toHaveBeenCalledOnce();
    expect(saveLlmResponseForQuery).toHaveBeenCalledWith(
      "B",
      "answer B",
      expect.anything(),
      "run-b",
    );
    expect(updateResponseImmediately).toHaveBeenLastCalledWith("answer B");
    expect(vi.mocked(updateTextGenerationState).mock.calls).toHaveLength(
      stateWritesAfterB,
    );
    expect(vi.mocked(generateTextWithWllama).mock.calls[0][0]?.aborted).toBe(
      true,
    );
  });

  it("leaves a restored answer alone and saves nothing under it", async () => {
    const running = startSearch("A", "run-a");
    await vi.waitFor(() => expect(finish).toHaveLength(1));

    // The history restore cancels the answer, then switches to its entry.
    cancelSearchAnswer();
    vi.mocked(getCurrentSearchRunId).mockReturnValue("run-restored");
    vi.mocked(updateTextGenerationState).mockClear();
    finish[0]("answer A");
    await running;

    expect(saveLlmResponseForQuery).not.toHaveBeenCalled();
    expect(updateResponseImmediately).not.toHaveBeenCalled();
    expect(updateTextGenerationState).not.toHaveBeenCalled();
  });

  it("saves only the regenerated answer after Stop", async () => {
    const stopped = startSearch("A", "run-a");
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    interruptSearch();
    const regenerated = startSearch("A", "run-a");
    await vi.waitFor(() => expect(finish).toHaveLength(2));

    expect(vi.mocked(generateTextWithWllama).mock.calls[0][0]?.aborted).toBe(
      true,
    );
    finish[1]("new answer");
    await regenerated;
    finish[0]("stopped answer");
    await stopped;

    expect(saveLlmResponseForQuery).toHaveBeenCalledOnce();
    expect(saveLlmResponseForQuery).toHaveBeenCalledWith(
      "A",
      "new answer",
      expect.anything(),
      "run-a",
    );
  });

  it("saves an answer under its own search when a new one is being set up", async () => {
    const running = startSearch("A", "run-a");
    await vi.waitFor(() => expect(finish).toHaveLength(1));

    // The search form switches the query and run id, then awaits the history
    // write before it starts the new search.
    vi.mocked(getQuery).mockReturnValue("B");
    vi.mocked(getCurrentSearchRunId).mockReturnValue("run-b");
    finish[0]("answer A");
    await running;

    expect(saveLlmResponseForQuery).toHaveBeenCalledWith(
      "A",
      "answer A",
      expect.anything(),
      "run-a",
    );
  });

  it("publishes nothing when replaced while the answer is being saved", async () => {
    let finishSave: () => void = () => {};
    vi.mocked(saveLlmResponseForQuery).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve();
        }),
    );
    const first = startSearch("A", "run-a");
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    finish[0]("answer A");
    await vi.waitFor(() => expect(saveLlmResponseForQuery).toHaveBeenCalled());

    const second = startSearch("B", "run-b");
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    vi.mocked(updateTextGenerationState).mockClear();
    finishSave();
    await first;

    expect(updateResponseImmediately).not.toHaveBeenCalledWith("answer A");
    expect(updateTextGenerationState).not.toHaveBeenCalled();
    finish[1]("answer B");
    await second;
  });

  it("does not leave the download gate once a restore cancelled the run", async () => {
    mockGetSettings.mockReturnValue({
      inferenceType: "browser",
      enableAiResponse: true,
      enableTextSearch: false,
      enableImageSearch: false,
      allowAiModelDownload: false,
    } as never);
    let allowDownload: (settings: never) => void = () => {};
    vi.mocked(listenToSettingsChanges).mockImplementation((listener) => {
      allowDownload = listener as unknown as (settings: never) => void;
      return vi.fn();
    });
    const parked = startSearch("A", "run-a");
    await vi.waitFor(() =>
      expect(updateTextGenerationState).toHaveBeenCalledWith(
        "awaitingModelDownloadAllowance",
      ),
    );

    cancelSearchAnswer();
    vi.mocked(updateTextGenerationState).mockClear();
    allowDownload({ allowAiModelDownload: true } as never);
    await parked;

    expect(updateTextGenerationState).not.toHaveBeenCalled();
    expect(generateTextWithWllama).not.toHaveBeenCalled();
  });
});
