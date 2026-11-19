import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));
vi.mock("./textGeneration", () => ({
  generateChatResponse: vi.fn(() => Promise.resolve("")),
  generateReplyToMessages: vi.fn(() => Promise.resolve("")),
}));

import { generateRelatedSearchQuery } from "./relatedSearchQuery";
import {
  generateChatResponse,
  generateReplyToMessages,
} from "./textGeneration";

const mockGenerateReplyToMessages = vi.mocked(generateReplyToMessages);

beforeEach(() => vi.clearAllMocks());

describe("generateRelatedSearchQuery", () => {
  it("writes the query from the conversation alone, without the search results in front", async () => {
    mockGenerateReplyToMessages.mockResolvedValueOnce(
      '"Burj Khalifa height in meters"',
    );

    const query = await generateRelatedSearchQuery([
      { role: "user", content: "what is the tallest building in dubai" },
      { role: "assistant", content: "The Burj Khalifa." },
      { role: "user", content: "what is its height" },
    ]);

    expect(query).toBe("Burj Khalifa height in meters");
    // The answer prompt carries pages in many languages, and with them in
    // front a small model wrote the query in one of those languages.
    expect(generateChatResponse).not.toHaveBeenCalled();
    const [messages] = mockGenerateReplyToMessages.mock.calls[0];
    expect(messages.slice(0, 2)).toEqual([
      { role: "user", content: "what is the tallest building in dubai" },
      { role: "assistant", content: "The Burj Khalifa." },
    ]);
    expect(messages[2].content).toContain("what is its height");
    expect(messages[2].content).toContain("name that thing in the query");
  });

  it("returns nothing when the generation fails", async () => {
    mockGenerateReplyToMessages.mockRejectedValueOnce(new Error("offline"));

    expect(
      await generateRelatedSearchQuery([{ role: "user", content: "hello" }]),
    ).toBe("");
  });
});
