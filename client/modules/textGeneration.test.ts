import gptTokenizer from "gpt-tokenizer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "./logEntries";
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
  listenToSettingsChanges: vi.fn(() => vi.fn()),
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
    // Deterministic stand-in: whitespace-delimited words as tokens, so
    // tests can reason about counts. Note "\n\n" splits to ["", ""] —
    // the separator itself costs tokens, mirroring that joins tokenize.
    encode: vi.fn((text: string) =>
      text.length === 0 ? [] : text.split(/\s+/),
    ),
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

    it("should encode each part exactly once and never a joined candidate", () => {
      const { summarizeDroppedMessages } = textGenerationFunctions;
      const messages: ChatMessage[] = [
        { role: "user", content: "What is AI?" },
        {
          role: "assistant",
          content: "AI stands for Artificial Intelligence.",
        },
      ];
      summarizeDroppedMessages(messages, "Previous context");

      // Separator first, then the loop walking newest to oldest — each
      // string once, and the only argument containing "\n\n" is the bare
      // separator whose cost is charged per join.
      const encoded = vi
        .mocked(gptTokenizer.encode)
        .mock.calls.map(([text]) => text);
      expect(encoded).toEqual([
        "\n\n",
        "ASSISTANT: AI stands for Artificial Intelligence.",
        "USER: What is AI?",
        "Previous context",
      ]);
      expect(encoded.filter((text) => text.includes("\n\n"))).toEqual(["\n\n"]);
    });

    it("should never exceed the budget, charging the separator per join", () => {
      const { summarizeDroppedMessages } = textGenerationFunctions;
      const messages: ChatMessage[] = [
        { role: "user", content: "one two three" }, // 4 tokens
        { role: "assistant", content: "four five six" }, // 4 tokens
      ];
      // Newest-first: 4, then 4+4+2=10, then 10+2+2=14 > 12 — the
      // previous summary is the one that does not fit.
      const result = summarizeDroppedMessages(messages, "old summary", 12);

      expect(result).toBe("USER: one two three\n\nASSISTANT: four five six");
      expect(gptTokenizer.encode(result).length).toBeLessThanOrEqual(12);
      expect(vi.mocked(addLogEntry)).toHaveBeenCalledWith(
        "Updated rolling summary (10 tokens)",
      );
    });

    it("should keep the newest parts when the budget cannot hold everything", () => {
      const { summarizeDroppedMessages } = textGenerationFunctions;
      const messages: ChatMessage[] = [
        { role: "user", content: "oldest" },
        { role: "assistant", content: "middle" },
        { role: "user", content: "newest" },
      ];
      // Each part is 2 tokens and the separator 2; 2+2+2=6 fits,
      // adding the oldest would make 10.
      const result = summarizeDroppedMessages(messages, "", 6);

      expect(result).toBe("ASSISTANT: middle\n\nUSER: newest");
    });

    it("should return an empty summary when even the newest part exceeds the budget", () => {
      const { summarizeDroppedMessages } = textGenerationFunctions;
      const messages: ChatMessage[] = [
        { role: "user", content: "one two three" },
      ];
      const result = summarizeDroppedMessages(messages, "", 2);

      expect(result).toBe("");
      expect(vi.mocked(addLogEntry)).toHaveBeenCalledWith(
        "Updated rolling summary (0 tokens)",
      );
    });

    it("should return an empty summary when there is nothing to keep", () => {
      const { summarizeDroppedMessages } = textGenerationFunctions;

      expect(summarizeDroppedMessages([], "")).toBe("");
    });

    it("should skip whitespace-only messages", () => {
      const { summarizeDroppedMessages } = textGenerationFunctions;
      const messages: ChatMessage[] = [
        { role: "user", content: "   " },
        { role: "assistant", content: "kept" },
      ];

      expect(summarizeDroppedMessages(messages, "")).toBe("ASSISTANT: kept");
    });

    it("should over-count rather than risk exceeding the budget", () => {
      const { summarizeDroppedMessages } = textGenerationFunctions;
      const messages: ChatMessage[] = [
        { role: "user", content: "a b" },
        { role: "assistant", content: "c d" },
      ];
      // Charged 3+3+2(separator)=8 against a limit of 8; the real joined
      // string tokenises to 6. The logged count is the conservative
      // (higher) one — the residual error never runs over budget.
      summarizeDroppedMessages(messages, "", 8);

      expect(vi.mocked(addLogEntry)).toHaveBeenCalledWith(
        "Updated rolling summary (8 tokens)",
      );
      const joined = "USER: a b\n\nASSISTANT: c d";
      expect(gptTokenizer.encode(joined).length).toBeLessThan(8);
    });
  });
});
