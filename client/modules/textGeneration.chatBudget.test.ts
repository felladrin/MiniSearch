import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  historyMock,
  logEntriesMock,
  notificationsMock,
  pubSubMock,
  searchMock,
} from "./textGenerationTestUtils";

const state = vi.hoisted(() => ({
  settings: { inferenceType: "browser" } as {
    inferenceType: string;
    openAiContextLength?: number;
    reasoningStartMarker?: string;
    reasoningEndMarker?: string;
  },
  systemPrompt: "",
}));

vi.mock("./pubSub", () => pubSubMock(() => state.settings));
vi.mock("./history", () => historyMock(() => "run-1"));
vi.mock("./logEntries", () => logEntriesMock());
vi.mock("./notifications", () => notificationsMock());
vi.mock("./search", () => searchMock());
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
  default: {
    encode: vi.fn((text: string) =>
      Array.from(text, (char) => char.codePointAt(0) ?? 0),
    ),
    decode: vi.fn((tokens: number[]) => String.fromCodePoint(...tokens)),
  },
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
import {
  generateChatResponse,
  generateReplyToMessages,
} from "./textGeneration";
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

/** Answers the summarizer call with `summary`, every other call with the answer. */
function mockSummarizerReturning(summary: string) {
  vi.mocked(generateChatWithWllama).mockImplementation(async (messages) =>
    messages[0].content.startsWith(summarizerInstruction)
      ? summary
      : "the answer",
  );
}

/** Total characters in a chat, which is its token count under this tokenizer. */
function contentLength(chat: ChatMessage[]) {
  return chat.reduce((total, message) => total + message.content.length, 0);
}

/**
 * A summary slot that survives between turns, as the pubsub store does. The
 * mock reads and writes it, so a test can watch what the turns folded in.
 */
function stubPersistentSummarySlot() {
  const slot: { current: ReturnType<typeof getConversationSummary> } = {
    current: { conversationId: "", summary: "" },
  };
  vi.mocked(getConversationSummary).mockImplementation(() => slot.current);
  vi.mocked(updateConversationSummary).mockImplementation((next) => {
    slot.current = next;
  });
  return slot;
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
    // Budget 3072 - 1000 - 3 ("Ok!") - 300 (question) = 1769. Turns are
    // dropped, so a full 800-token summary and its 116-token label are
    // reserved too, leaving 853 for older turns: the newest two (200) fit,
    // the 900-token answer before them does not.
    state.systemPrompt = "s".repeat(1000);
    const messages: ChatMessage[] = [
      { role: "user", content: "u".repeat(900) },
      { role: "assistant", content: "a".repeat(900) },
      { role: "user", content: "v".repeat(100) },
      { role: "assistant", content: "b".repeat(100) },
      { role: "user", content: "w".repeat(300) },
    ];

    await generateChatResponse(messages, () => {});

    const { answer, summarizer } = callsTo(generateChatWithWllama);
    expect(answer[0].slice(2)).toEqual(messages.slice(2));
    expect(summarizer).toHaveLength(1);
    expect(summarizer[0][0].content).toContain("u".repeat(900));
    expect(summarizer[0][0].content).not.toContain("w".repeat(300));
  });

  it.each([800, 2000])(
    "keeps the prompt within the budget when the summarizer returns %i tokens",
    async (summaryTokens) => {
      // Without the summary, 3072 - 1500 - 3 - 300 = 1269 would keep the
      // newest two turns (800). With a full summary section reserved
      // (800 + 116), 353 is left, so they are folded into the summary too.
      state.systemPrompt = "s".repeat(1500);
      const messages: ChatMessage[] = [
        { role: "user", content: "a".repeat(600) },
        { role: "assistant", content: "b".repeat(200) },
        { role: "user", content: "c".repeat(400) },
        { role: "assistant", content: "d".repeat(400) },
        { role: "user", content: "q".repeat(300) },
      ];
      vi.mocked(generateChatWithWllama).mockImplementation(async (chat) =>
        chat[0].content.startsWith(summarizerInstruction)
          ? "z".repeat(summaryTokens)
          : "the answer",
      );

      await generateChatResponse(messages, () => {});

      const { answer, summarizer } = callsTo(generateChatWithWllama);
      const sentTokens = contentLength(answer[0]);
      expect(sentTokens).toBeLessThanOrEqual(3072);
      expect(answer[0].slice(2)).toEqual(messages.slice(4));
      for (const dropped of messages.slice(0, 4)) {
        expect(summarizer[0][0].content).toContain(dropped.content);
      }
      expect(updateConversationSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "a".repeat(600),
          summary: "z".repeat(800),
        }),
      );
    },
  );

  it("cuts the summary to the room a large prompt leaves, and stores it whole", async () => {
    // 3072 - 2600 - 3 - 300 leaves under 800 tokens for the summary section,
    // so the summary in the prompt is cut to fit, while the stored one keeps
    // its 800 tokens for a later turn with more room.
    state.systemPrompt = "s".repeat(2600);
    const messages: ChatMessage[] = [
      { role: "user", content: "a".repeat(600) },
      { role: "assistant", content: "b".repeat(200) },
      { role: "user", content: "q".repeat(300) },
    ];
    vi.mocked(generateChatWithWllama).mockImplementation(async (chat) =>
      chat[0].content.startsWith(summarizerInstruction)
        ? "z".repeat(2000)
        : "the answer",
    );

    await generateChatResponse(messages, () => {});

    const { answer } = callsTo(generateChatWithWllama);
    const sentTokens = contentLength(answer[0]);
    expect(sentTokens).toBeLessThanOrEqual(3072);
    expect(answer[0][0].content).toContain("z");
    expect(answer[0].slice(2)).toEqual(messages.slice(2));
    expect(updateConversationSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "a".repeat(600),
        summary: "z".repeat(800),
      }),
    );
  });

  it("folds each dropped turn into the summary once across turns", async () => {
    // The summary slot persists between turns, as the pubsub store does.
    const slot = stubPersistentSummarySlot();
    mockGenerateChat(generateChatWithWllama);
    state.systemPrompt = "s".repeat(2000);
    const firstExchange: ChatMessage[] = [
      { role: "user", content: "a".repeat(500) },
      { role: "assistant", content: "b".repeat(500) },
    ];
    const secondExchange: ChatMessage[] = [
      { role: "user", content: "c".repeat(300) },
      { role: "assistant", content: "d".repeat(300) },
    ];
    const question: ChatMessage = { role: "user", content: "e".repeat(300) };

    await generateChatResponse(
      [...firstExchange, { role: "user", content: "c".repeat(300) }],
      () => {},
    );
    expect(slot.current.summarizedCount).toBe(2);

    const turnTwo = [...firstExchange, ...secondExchange, question];
    await generateChatResponse(turnTwo, () => {});
    // The same history again (a regenerated answer) drops nothing new.
    await generateChatResponse(turnTwo, () => {});

    const { summarizer } = callsTo(generateChatWithWllama);
    expect(summarizer).toHaveLength(2);
    expect(summarizer[0][0].content).toContain("a".repeat(500));
    expect(summarizer[1][0].content).toContain("c".repeat(300));
    expect(summarizer[1][0].content).toContain("d".repeat(300));
    expect(summarizer[1][0].content).not.toContain("a".repeat(500));
    expect(summarizer[1][0].content).not.toContain("b".repeat(500));
    expect(slot.current.summarizedCount).toBe(4);
  });

  it("folds again from the start once an edit reaches into the summary", async () => {
    const slot = stubPersistentSummarySlot();
    mockGenerateChat(generateChatWithWllama);
    state.systemPrompt = "s".repeat(2000);
    const question: ChatMessage = { role: "user", content: "c".repeat(300) };

    await generateChatResponse(
      [
        { role: "user", content: "a".repeat(500) },
        { role: "assistant", content: "b".repeat(500) },
        question,
      ],
      () => {},
    );
    await generateChatResponse(
      [
        { role: "user", content: "a".repeat(500) },
        { role: "assistant", content: "x".repeat(500) },
        question,
      ],
      () => {},
    );

    const { summarizer } = callsTo(generateChatWithWllama);
    expect(summarizer).toHaveLength(2);
    expect(summarizer[1][0].content).toContain("a".repeat(500));
    expect(summarizer[1][0].content).toContain("x".repeat(500));
    expect(summarizer[1][0].content).toContain("Previous summary:\n(none)");
    expect(slot.current.summarizedCount).toBe(2);
  });

  it.each([
    {
      title: "rejects",
      summarize: () => {
        throw new Error("summarizer unavailable");
      },
    },
    { title: "resolves to an empty string", summarize: () => "" },
  ])(
    "keeps the stored summary when the summarizer $title",
    async ({ summarize }) => {
      state.systemPrompt = "s".repeat(2000);
      const messages: ChatMessage[] = [
        { role: "user", content: "first question" },
        { role: "assistant", content: "x".repeat(1500) },
        { role: "user", content: "follow-up question" },
      ];
      vi.mocked(getConversationSummary).mockReturnValue({
        conversationId: "first question",
        summary: "S1",
      });
      vi.mocked(generateChatWithWllama).mockImplementation(async (chat) =>
        chat[0].content.startsWith(summarizerInstruction)
          ? summarize()
          : "the answer",
      );

      await generateChatResponse(messages, () => {});

      expect(updateConversationSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "first question",
          summary: "S1",
          summarizedCount: 0,
        }),
      );
      const { answer } = callsTo(generateChatWithWllama);
      expect(answer).toHaveLength(1);
      expect(answer[0][0].content).toContain("S1");
    },
  );
});

describe("reasoning in earlier assistant turns", () => {
  const reasoning = "Let me think about the first question at length.";
  const turnsWithReasoning: ChatMessage[] = [
    { role: "user", content: "first question" },
    {
      role: "assistant",
      content: `<think>${reasoning}</think>\n\nfirst answer`,
    },
  ];
  const question: ChatMessage = { role: "user", content: "second question" };

  beforeEach(() => {
    vi.clearAllMocks();
    state.settings = {
      inferenceType: "browser",
      reasoningStartMarker: "<think>",
      reasoningEndMarker: "</think>",
    };
    state.systemPrompt = "";
    mockGenerateChat(generateChatWithWllama);
  });

  function sentText(messages: ChatMessage[]) {
    return messages.map((message) => message.content).join("\n");
  }

  it("keeps the reasoning out of the main continuation", async () => {
    await generateChatResponse([...turnsWithReasoning, question], () => {});

    const { answer } = callsTo(generateChatWithWllama);
    expect(sentText(answer[0])).toContain("first answer");
    expect(sentText(answer[0])).not.toContain(reasoning);
  });

  it("keeps the reasoning out of the summary prompt and the stored summary", async () => {
    state.systemPrompt = "s".repeat(3500);
    vi.mocked(generateChatWithWllama).mockImplementation(async (chat) => {
      if (chat[0].content.startsWith(summarizerInstruction)) {
        throw new Error("summarizer unavailable");
      }
      return "the answer";
    });

    await generateChatResponse([...turnsWithReasoning, question], () => {});

    const { summarizer } = callsTo(generateChatWithWllama);
    expect(sentText(summarizer[0])).toContain("first answer");
    expect(sentText(summarizer[0])).not.toContain(reasoning);
    const [stored] = vi.mocked(updateConversationSummary).mock.calls[0];
    expect(stored.summary).toContain("first answer");
    expect(stored.summary).not.toContain(reasoning);
  });

  it("keeps the reasoning out of replies built from the conversation", async () => {
    await generateReplyToMessages([...turnsWithReasoning, question]);

    const [[sent]] = vi.mocked(generateChatWithWllama).mock.calls;
    expect(sentText(sent)).toContain("first answer");
    expect(sentText(sent)).not.toContain(reasoning);
  });
});
