import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateFollowUpQuestion } from "./followUpQuestions";

vi.mock("./pubSub", () => ({
  getSuppressNextFollowUp: vi.fn(() => false),
}));

vi.mock("./textGeneration", () => ({
  generateChatResponse: vi.fn(),
}));

import { getSuppressNextFollowUp } from "./pubSub";
import { generateChatResponse } from "./textGeneration";

const mockedGenerateChatResponse = vi.mocked(generateChatResponse);
const mockedGetSuppressNextFollowUp = vi.mocked(getSuppressNextFollowUp);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSuppressNextFollowUp.mockReturnValue(false);
});

describe("generateFollowUpQuestion", () => {
  it("keeps an English question with leading numbering", async () => {
    mockedGenerateChatResponse.mockResolvedValue(
      "1. What about the alternatives?",
    );

    const question = await generateFollowUpQuestion({
      topic: "cats",
      currentContent: "Cats are independent.",
    });

    expect(question).toBe("What about the alternatives?");
  });

  it("keeps a Chinese question ending in a fullwidth question mark", async () => {
    mockedGenerateChatResponse.mockResolvedValue("你觉得这个方案怎么样？");

    const question = await generateFollowUpQuestion({
      topic: "方案",
      currentContent: "方案可行。",
    });

    expect(question).toBe("你觉得这个方案怎么样？");
  });

  it("strips a leading bullet from a Japanese question without touching the text", async () => {
    mockedGenerateChatResponse.mockResolvedValue(
      "- この案についてどう思いますか？",
    );

    const question = await generateFollowUpQuestion({
      topic: "案",
      currentContent: "案は実行可能です。",
    });

    expect(question).toBe("この案についてどう思いますか？");
  });

  it("keeps an Arabic question ending in an Arabic question mark", async () => {
    mockedGenerateChatResponse.mockResolvedValue("ما رأيك في البدائل؟");

    const question = await generateFollowUpQuestion({
      topic: "البدائل",
      currentContent: "البدائل متاحة.",
    });

    expect(question).toBe("ما رأيك في البدائل؟");
  });

  it("returns an empty string when no line ends with a question mark", async () => {
    mockedGenerateChatResponse.mockResolvedValue("No questions here.");

    const question = await generateFollowUpQuestion({
      topic: "cats",
      currentContent: "Cats are independent.",
    });

    expect(question).toBe("");
  });

  it("returns an empty string when follow-up questions are suppressed", async () => {
    mockedGetSuppressNextFollowUp.mockReturnValue(true);

    const question = await generateFollowUpQuestion({
      topic: "cats",
      currentContent: "Cats are independent.",
    });

    expect(mockedGenerateChatResponse).not.toHaveBeenCalled();
    expect(question).toBe("");
  });
});
