import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateFollowUpQuestion } from "./followUpQuestions";

vi.mock("./textGeneration", () => ({
  generateChatResponse: vi.fn(),
  generateReplyToMessages: vi.fn(),
}));

import {
  generateChatResponse,
  generateReplyToMessages,
} from "./textGeneration";

const mockedGenerateReplyToMessages = vi.mocked(generateReplyToMessages);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateFollowUpQuestion", () => {
  it("keeps an English question with leading numbering", async () => {
    mockedGenerateReplyToMessages.mockResolvedValue(
      "1. What about the alternatives?",
    );

    const question = await generateFollowUpQuestion({
      topic: "cats",
      currentContent: "Cats are independent.",
    });

    expect(question).toBe("What about the alternatives?");
  });

  it("keeps a Chinese question ending in a fullwidth question mark", async () => {
    mockedGenerateReplyToMessages.mockResolvedValue("你觉得这个方案怎么样？");

    const question = await generateFollowUpQuestion({
      topic: "方案",
      currentContent: "方案可行。",
    });

    expect(question).toBe("你觉得这个方案怎么样？");
  });

  it("strips a leading bullet from a Japanese question without touching the text", async () => {
    mockedGenerateReplyToMessages.mockResolvedValue(
      "- この案についてどう思いますか？",
    );

    const question = await generateFollowUpQuestion({
      topic: "案",
      currentContent: "案は実行可能です。",
    });

    expect(question).toBe("この案についてどう思いますか？");
  });

  it("keeps an Arabic question ending in an Arabic question mark", async () => {
    mockedGenerateReplyToMessages.mockResolvedValue("ما رأيك في البدائل؟");

    const question = await generateFollowUpQuestion({
      topic: "البدائل",
      currentContent: "البدائل متاحة.",
    });

    expect(question).toBe("ما رأيك في البدائل؟");
  });

  it("returns an empty string when no line ends with a question mark", async () => {
    mockedGenerateReplyToMessages.mockResolvedValue("No questions here.");

    const question = await generateFollowUpQuestion({
      topic: "cats",
      currentContent: "Cats are independent.",
    });

    expect(question).toBe("");
  });
});

describe("generateFollowUpQuestion and the chat generation", () => {
  it("sends the prompt alone, with the topic and the answer in it", async () => {
    mockedGenerateReplyToMessages.mockResolvedValue("What comes next?");

    await generateFollowUpQuestion({
      topic: "cats",
      currentContent: "Cats sleep up to sixteen hours a day.",
      previousQuestions: ["Why do cats purr?"],
    });

    // The chat path puts the system prompt and the search results in front,
    // and keys the conversation summary by the first message.
    expect(generateChatResponse).not.toHaveBeenCalled();
    const [messages] = mockedGenerateReplyToMessages.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("cats");
    expect(messages[0].content).toContain(
      "Cats sleep up to sixteen hours a day.",
    );
    expect(messages[0].content).toContain("1. Why do cats purr?");
  });

  it("returns an empty string when the prompt is too long to send", async () => {
    mockedGenerateReplyToMessages.mockRejectedValue(
      new Error("The newest message is too long"),
    );

    const question = await generateFollowUpQuestion({
      topic: "cats",
      currentContent: "Cats are independent. ".repeat(5000),
    });

    expect(question).toBe("");
  });
});

describe("generateFollowUpQuestion and the chat history", () => {
  it("writes no chat rows for the follow-up exchange, since nothing reads them", async () => {
    const { historyDatabase } = await import("./history");
    const before = await historyDatabase.chatHistory.count();
    mockedGenerateReplyToMessages.mockResolvedValue("1. What comes next?");

    await generateFollowUpQuestion({
      topic: "cats",
      currentContent: "Cats are independent.",
    });

    expect(await historyDatabase.chatHistory.count()).toBe(before);
  });
});

describe("generateFollowUpQuestion and reasoning", () => {
  it("leaves the reasoning block out of the prompt", async () => {
    mockedGenerateReplyToMessages.mockResolvedValue("1. What comes next?");

    await generateFollowUpQuestion({
      topic: "cats",
      currentContent:
        "<think>The user wants cat facts.</think>\n\nCats are independent.",
    });

    const [messages] = mockedGenerateReplyToMessages.mock.calls[0];
    const prompt = messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("Cats are independent.");
    expect(prompt).not.toContain("The user wants cat facts.");
  });
});
