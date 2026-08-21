import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textGenerationFunctions } from "./textGeneration";
import type { ChatMessage } from "./types";

const mockGetSettings = vi.fn();
const mockGetConversationSummary = vi.fn();

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.mock("./pubSub", () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  getConversationSummary: (...args: unknown[]) =>
    mockGetConversationSummary(...args),
  listenToSettingsChanges: vi.fn(),
  updateConversationSummary: vi.fn(),
  updateTextGenerationState: vi.fn(),
  getTextGenerationState: vi.fn(),
  getResponse: vi.fn(),
  getQuery: vi.fn(),
  updateResponse: vi.fn(),
  updateSearchPromise: vi.fn(),
  updateTextSearchResults: vi.fn(),
  updateTextSearchState: vi.fn(),
  updateImageSearchResults: vi.fn(),
  updateImageSearchState: vi.fn(),
  updateChatMessages: vi.fn(),
  updateLlmTextSearchResults: vi.fn(),
}));

vi.mock("./history", () => ({
  getCurrentSearchRunId: vi.fn().mockResolvedValue("run-123"),
  saveLlmResponseForQuery: vi.fn(),
  updateSearchResults: vi.fn(),
}));

vi.mock("./search", () => ({
  searchText: vi.fn(),
  searchImages: vi.fn(),
}));

vi.mock("./systemPrompt", () => ({
  getSystemPrompt: vi.fn().mockReturnValue("You are a helpful assistant."),
}));

vi.mock("gpt-tokenizer", () => ({
  default: {
    encode: vi.fn().mockReturnValue({ data: [1, 2, 3] }),
    decode: vi.fn(),
  },
}));

vi.mock("./textGenerationUtilities", () => ({
  ChatGenerationError: class ChatGenerationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ChatGenerationError";
    }
  },
  defaultContextSize: 6000,
  getFormattedSearchResults: vi
    .fn()
    .mockReturnValue("Formatted search results"),
}));

describe("textGenerationFunctions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReset();
    mockGetConversationSummary.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getCurrentModelName", () => {
    it.each([
      ["openai", { inferenceType: "openai", openAiApiModel: "gpt-4" }, "gpt-4"],
      ["horde", { inferenceType: "horde" }, "AI Horde"],
      ["internal", { inferenceType: "internal" }, "Internal API"],
      [
        "browser",
        { inferenceType: "browser", wllamaModelId: "wllama-model" },
        "wllama-model",
      ],
      ["an unknown backend", { inferenceType: "unknown" }, "Unknown"],
    ])("should name the model for %s", (_, settings, expected) => {
      mockGetSettings.mockReturnValue(settings as never);

      expect(textGenerationFunctions.getCurrentModelName()).toBe(expected);
    });
  });

  describe("getConversationId", () => {
    it("should return trimmed content of first user message", () => {
      const { getConversationId } = textGenerationFunctions;
      const messages: ChatMessage[] = [
        { role: "user", content: "  Hello world  " },
        { role: "assistant", content: "Hi there!" },
      ];
      const result = getConversationId(messages);
      expect(result).toBe("Hello world");
    });

    it("should return empty string when there is no user message", () => {
      const { getConversationId } = textGenerationFunctions;

      expect(getConversationId([{ role: "assistant", content: "Hi!" }])).toBe(
        "",
      );
      expect(getConversationId([])).toBe("");
    });

    it("should return first user message when multiple user messages exist", () => {
      const { getConversationId } = textGenerationFunctions;
      const messages: ChatMessage[] = [
        { role: "user", content: "First question" },
        { role: "assistant", content: "Answer" },
        { role: "user", content: "Second question" },
      ];
      const result = getConversationId(messages);
      expect(result).toBe("First question");
    });
  });

  describe("loadConversationSummary", () => {
    it("should return summary when conversationId matches", () => {
      const { loadConversationSummary } = textGenerationFunctions;
      mockGetConversationSummary.mockReturnValue({
        conversationId: "test-id",
        summary: "Previous summary",
      });
      const result = loadConversationSummary("test-id");
      expect(result).toBe("Previous summary");
    });

    it("should return empty string when conversationId does not match", () => {
      const { loadConversationSummary } = textGenerationFunctions;
      mockGetConversationSummary.mockReturnValue({
        conversationId: "different-id",
        summary: "Previous summary",
      });
      const result = loadConversationSummary("test-id");
      expect(result).toBe("");
    });

    it("should return empty string when no summary stored", () => {
      const { loadConversationSummary } = textGenerationFunctions;
      mockGetConversationSummary.mockReturnValue({
        conversationId: "",
        summary: "",
      });
      const result = loadConversationSummary("test-id");
      expect(result).toBe("");
    });
  });

  describe("summarizeDroppedMessages", () => {
    it("should return previous summary when dropped messages are empty", () => {
      const { summarizeDroppedMessages } = textGenerationFunctions;
      const result = summarizeDroppedMessages([], "previous");
      expect(result).toBe("previous");
    });

    it("should format dropped messages correctly", () => {
      const { summarizeDroppedMessages } = textGenerationFunctions;
      const messages: ChatMessage[] = [
        { role: "user", content: "What is AI?" },
        {
          role: "assistant",
          content: "AI stands for Artificial Intelligence.",
        },
      ];
      const result = summarizeDroppedMessages(messages, "");

      expect(result).toContain("What is AI?");
      expect(result).toContain("AI stands for Artificial Intelligence.");
    });

    it("should prepend previous summary when provided", () => {
      const { summarizeDroppedMessages } = textGenerationFunctions;
      const messages: ChatMessage[] = [
        { role: "user", content: "New question" },
      ];
      const result = summarizeDroppedMessages(messages, "Previous context");

      expect(result).toContain("Previous context");
      expect(result).toContain("New question");
    });
  });
});
