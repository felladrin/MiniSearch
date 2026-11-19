import { describe, expect, it, vi } from "vitest";

vi.mock("./pubSub", () => ({
  getConversationSummary: vi.fn(() => ({ conversationId: "", summary: "" })),
  getQuery: vi.fn(() => ""),
  getResponse: vi.fn(() => ""),
  getSettings: vi.fn(() => ({
    inferenceType: "browser",
    enableAiResponse: true,
    enableTextSearch: true,
    enableImageSearch: true,
    searchResultsLimit: 10,
    allowAiModelDownload: true,
  })),
  getTextGenerationState: vi.fn(() => "idle"),
  listenToSettingsChanges: vi.fn(() => vi.fn()),
  updateChatMessages: vi.fn(),
  updateConversationSummary: vi.fn(),
  updateImageSearchResults: vi.fn(),
  updateImageSearchState: vi.fn(),
  updateLlmTextSearchResults: vi.fn(),
  updateResponse: vi.fn(),
  updateSearchPromise: vi.fn(),
  updateTextGenerationState: vi.fn(),
  updateTextSearchResults: vi.fn(),
  updateTextSearchState: vi.fn(),
}));
vi.mock("./history", () => ({
  getCurrentSearchRunId: vi.fn(() => "run-1"),
  saveLlmResponseForQuery: vi.fn(() => Promise.resolve()),
  updateSearchResults: vi.fn(() => Promise.resolve()),
}));
vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));
vi.mock("./notifications", () => ({ showAiCompleteNotification: vi.fn() }));
vi.mock("./search", () => ({
  searchImages: vi.fn(() => Promise.resolve([])),
  searchText: vi.fn(() => Promise.resolve([])),
}));
vi.mock("./systemPrompt", () => ({ getSystemPrompt: vi.fn(() => "") }));
vi.mock("./textGenerationUtilities", () => ({
  ChatGenerationError: class ChatGenerationError extends Error {},
  defaultContextSize: 4096,
  getFormattedSearchResults: vi.fn(() => ""),
  searchResultsToConsider: 6,
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
import { getSettings } from "./pubSub";
import {
  generateReplyToMessages,
  textGenerationFunctions,
} from "./textGeneration";
import { generateChatWithWllama } from "./textGenerationWithWllama";

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
    );
  });
});
