import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: { inferenceType: "browser" } as {
    inferenceType: string;
    openAiContextLength?: number;
  },
  systemPrompt: "",
}));

vi.mock("./pubSub", () => ({
  getConversationSummary: vi.fn(() => ({ conversationId: "", summary: "" })),
  getQuery: vi.fn(() => ""),
  getResponse: vi.fn(() => ""),
  getSettings: vi.fn(() => state.settings),
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
// The system prompt stands in for everything that fills it (instructions,
// search results, page excerpts), so its length sets how much of the window
// is left for the conversation.
vi.mock("./systemPrompt", () => ({
  getSystemPrompt: vi.fn(() => state.systemPrompt),
}));
vi.mock("./textGenerationUtilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./textGenerationUtilities")>()),
  getFormattedSearchResults: vi.fn(() => Promise.resolve("")),
}));
// One token per character keeps the budget arithmetic readable.
vi.mock("gpt-tokenizer", () => ({
  default: { encode: vi.fn((text: string) => Array.from(text, () => 1)) },
}));
vi.mock("pretty-ms", () => ({ default: vi.fn(() => "100ms") }));
vi.mock("./textGenerationWithWllama", () => ({
  generateTextWithWllama: vi.fn(() => Promise.resolve()),
  generateChatWithWllama: vi.fn(),
}));
vi.mock("./textGenerationWithOpenAi", () => ({
  generateTextWithOpenAi: vi.fn(() => Promise.resolve()),
  generateChatWithOpenAi: vi.fn(),
}));

import { getConversationSummary, updateConversationSummary } from "./pubSub";
import { generateChatResponse } from "./textGeneration";
import { generateChatWithOpenAi } from "./textGenerationWithOpenAi";
import { generateChatWithWllama } from "./textGenerationWithWllama";
import type { ChatMessage } from "./types";

const summarizerInstruction = "You are the conversation memory manager.";

function mockGenerateChat(generateChat: typeof generateChatWithWllama) {
  vi.mocked(generateChat).mockImplementation(async (messages) =>
    messages[0].content.startsWith(summarizerInstruction)
      ? "folded summary"
      : "the answer",
  );
}

function callsTo(generateChat: typeof generateChatWithWllama) {
  const calls = vi
    .mocked(generateChat)
    .mock.calls.map(([messages]) => messages);
  return {
    summarizer: calls.filter((messages) =>
      messages[0].content.startsWith(summarizerInstruction),
    ),
    answer: calls.filter(
      (messages) => !messages[0].content.startsWith(summarizerInstruction),
    ),
  };
}

const earlierTurns: ChatMessage[] = [
  { role: "user", content: "first question" },
  { role: "assistant", content: "first answer" },
];

describe("generateChatResponse context budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.settings = { inferenceType: "browser" };
    state.systemPrompt = "";
    mockGenerateChat(generateChatWithWllama);
    mockGenerateChat(generateChatWithOpenAi);
  });

  it("sends the newest question when the budget is exhausted", async () => {
    // 3500 tokens of system prompt against a 4096 * 0.75 = 3072 history
    // budget leaves nothing for the conversation.
    state.systemPrompt = "s".repeat(3500);
    const question: ChatMessage = { role: "user", content: "q".repeat(500) };

    await generateChatResponse([...earlierTurns, question], () => {});

    const { answer } = callsTo(generateChatWithWllama);
    expect(answer).toHaveLength(1);
    expect(answer[0].at(-1)).toEqual(question);
  });

  it("folds only the turns before the current question into the summary", async () => {
    state.systemPrompt = "s".repeat(3500);
    const question = "the current question ".repeat(20);

    await generateChatResponse(
      [...earlierTurns, { role: "user", content: question }],
      () => {},
    );

    const { summarizer } = callsTo(generateChatWithWllama);
    expect(summarizer).toHaveLength(1);
    expect(summarizer[0][0].content).toContain("first question");
    expect(summarizer[0][0].content).not.toContain(question);
  });

  it("measures the budget against the configured OpenAI context", async () => {
    state.settings = { inferenceType: "openai", openAiContextLength: 32768 };
    // Excerpts sized from a 32768 window overflow a 4096-based budget, but fit
    // easily in 32768 * 0.75.
    state.systemPrompt = "s".repeat(11468);
    const messages: ChatMessage[] = [
      ...earlierTurns,
      { role: "user", content: "follow-up question" },
    ];

    await generateChatResponse(messages, () => {});

    const { answer, summarizer } = callsTo(generateChatWithOpenAi);
    expect(summarizer).toHaveLength(0);
    expect(answer[0].slice(2)).toEqual(messages);
    expect(updateConversationSummary).not.toHaveBeenCalled();
  });

  it("rejects before any generation when the newest message alone exceeds the window", async () => {
    const question: ChatMessage = { role: "user", content: "q".repeat(5000) };

    await expect(
      generateChatResponse([...earlierTurns, question], () => {}),
    ).rejects.toThrow("The newest message alone does not fit the context");

    expect(generateChatWithWllama).not.toHaveBeenCalled();
    expect(updateConversationSummary).not.toHaveBeenCalled();
  });

  it("answers a single long prompt without writing a conversation summary", async () => {
    // The follow-up question generator sends one synthetic message that embeds
    // the whole answer; it must not be folded into the chat's summary slot.
    state.systemPrompt = "s".repeat(2500);
    const prompt: ChatMessage = { role: "user", content: "a".repeat(1000) };

    await generateChatResponse([prompt], () => {});

    const { answer, summarizer } = callsTo(generateChatWithWllama);
    expect(summarizer).toHaveLength(0);
    expect(answer[0].at(-1)).toEqual(prompt);
    expect(updateConversationSummary).not.toHaveBeenCalled();
  });

  it("lets older turns share what the newest question leaves, starting on a user turn", async () => {
    // Budget 3072 - 2000 - 3 ("Ok!") = 1069; the question takes 300, leaving
    // 769 for older turns: the newest two (200) fit, the 600-token answer
    // before them does not.
    state.systemPrompt = "s".repeat(2000);
    const messages: ChatMessage[] = [
      { role: "user", content: "u".repeat(600) },
      { role: "assistant", content: "a".repeat(600) },
      { role: "user", content: "v".repeat(100) },
      { role: "assistant", content: "b".repeat(100) },
      { role: "user", content: "w".repeat(300) },
    ];

    await generateChatResponse(messages, () => {});

    const { answer, summarizer } = callsTo(generateChatWithWllama);
    expect(answer[0].slice(2)).toEqual(messages.slice(2));
    expect(summarizer).toHaveLength(1);
    expect(summarizer[0][0].content).toContain("u".repeat(600));
    expect(summarizer[0][0].content).not.toContain("w".repeat(300));
  });

  it("keeps the stored summary when the summarizer rejects and the fallback returns empty", async () => {
    state.systemPrompt = "s".repeat(3500);
    const messages: ChatMessage[] = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "x".repeat(900) },
      { role: "user", content: "follow-up question" },
    ];
    vi.mocked(getConversationSummary).mockReturnValue({
      conversationId: "first question",
      summary: "S1",
    });
    vi.mocked(generateChatWithWllama).mockImplementation(async (chat) => {
      if (chat[0].content.startsWith(summarizerInstruction)) {
        throw new Error("summarizer unavailable");
      }
      return "the answer";
    });

    await generateChatResponse(messages, () => {});

    expect(updateConversationSummary).toHaveBeenCalledWith({
      conversationId: "first question",
      summary: "S1",
    });
    const { answer } = callsTo(generateChatWithWllama);
    expect(answer).toHaveLength(1);
    expect(answer[0][0].content).toContain("S1");
  });

  it("keeps the stored summary when the summarizer resolves to an empty string", async () => {
    state.systemPrompt = "s".repeat(3500);
    const messages: ChatMessage[] = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "x".repeat(900) },
      { role: "user", content: "follow-up question" },
    ];
    vi.mocked(getConversationSummary).mockReturnValue({
      conversationId: "first question",
      summary: "S1",
    });
    vi.mocked(generateChatWithWllama).mockImplementation(async (chat) =>
      chat[0].content.startsWith(summarizerInstruction) ? "" : "the answer",
    );

    await generateChatResponse(messages, () => {});

    expect(updateConversationSummary).toHaveBeenCalledWith({
      conversationId: "first question",
      summary: "S1",
    });
    const { answer } = callsTo(generateChatWithWllama);
    expect(answer).toHaveLength(1);
    expect(answer[0][0].content).toContain("S1");
  });
});
