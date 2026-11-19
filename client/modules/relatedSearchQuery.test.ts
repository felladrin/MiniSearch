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

  it("asks the model to keep a relative date as written, for the date anchor to resolve", async () => {
    await generateRelatedSearchQuery([
      { role: "user", content: "who won the world series" },
      { role: "assistant", content: "The Dodgers won the 2026 World Series." },
      { role: "user", content: "who won it last year" },
    ]);

    const [messages] = mockGenerateReplyToMessages.mock.calls[0];
    // Given today's date instead, Gemma 3 4B wrote "November 2026" for
    // "next month" on 2026-11-19; `normalizeRelativeDates` gets it right.
    expect(messages[2].content).toContain("copy it word for word");
  });

  it.each([
    ["“Avengers: Doomsday release delay reasons”"],
    ["「Avengers: Doomsday release delay reasons」"],
    ["«Avengers: Doomsday release delay reasons»"],
  ])("removes the quote marks around %s", async (reply) => {
    mockGenerateReplyToMessages.mockResolvedValueOnce(reply);

    expect(
      await generateRelatedSearchQuery([{ role: "user", content: "why" }]),
    ).toBe("Avengers: Doomsday release delay reasons");
  });

  const chineseFollowUp = [
    { role: "user", content: "苹果什么时候发布新手机" },
    { role: "assistant", content: "苹果通常在九月发布新款 iPhone。" },
    { role: "user", content: "它大概多少钱" },
  ] as const;

  it("keeps a query that shares the question's script, with one model call", async () => {
    mockGenerateReplyToMessages.mockResolvedValueOnce("iPhone价格大概多少钱");

    expect(await generateRelatedSearchQuery([...chineseFollowUp])).toBe(
      "iPhone价格大概多少钱",
    );
    expect(mockGenerateReplyToMessages).toHaveBeenCalledTimes(1);
  });

  it("checks a Chinese question even when a brand name outweighs the Chinese", async () => {
    mockGenerateReplyToMessages.mockResolvedValueOnce("iPhone Pro Max price");

    await generateRelatedSearchQuery([
      { role: "user", content: "那 iPhone Pro Max 呢" },
    ]);

    const [messages] = mockGenerateReplyToMessages.mock.calls[1];
    expect(messages[0].content).toContain("into Chinese");
  });

  it.each([
    ["what are the side effects of β-blockers", "beta blocker side effects"],
    ["difference between α and β error", "alpha beta error difference"],
  ])("keeps the English query for %s", async (question, reply) => {
    mockGenerateReplyToMessages.mockResolvedValueOnce(reply);

    expect(
      await generateRelatedSearchQuery([{ role: "user", content: question }]),
    ).toBe(reply);
    expect(mockGenerateReplyToMessages).toHaveBeenCalledTimes(1);
  });

  it.each([["Xiaomi founder 雷军"], ["Tencent founder 马化腾"]])(
    "keeps an English query that adds a native name: %s",
    async (reply) => {
      mockGenerateReplyToMessages.mockResolvedValueOnce(reply);

      expect(
        await generateRelatedSearchQuery([
          { role: "user", content: "who founded it" },
        ]),
      ).toBe(reply);
      expect(mockGenerateReplyToMessages).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a Chinese query for a question that is mostly a brand name", async () => {
    mockGenerateReplyToMessages.mockResolvedValueOnce("苹果手机价格");

    expect(
      await generateRelatedSearchQuery([{ role: "user", content: "iPhone呢" }]),
    ).toBe("苹果手机价格");
  });

  it("keeps a Japanese query that adds kanji to a question in kana", async () => {
    mockGenerateReplyToMessages.mockResolvedValueOnce("東京タワー 入場料");

    expect(
      await generateRelatedSearchQuery([
        { role: "user", content: "それはいくらですか" },
      ]),
    ).toBe("東京タワー 入場料");
    expect(mockGenerateReplyToMessages).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["它大概多少钱", "Chinese"],
    ["東京タワーの高さは", "Japanese"],
    ["그거 얼마예요", "Korean"],
  ])(
    "asks for a translation into the language of %s",
    async (question, language) => {
      mockGenerateReplyToMessages.mockResolvedValueOnce("iPhone fiyatı kaç TL");

      await generateRelatedSearchQuery([{ role: "user", content: question }]);

      const [messages] = mockGenerateReplyToMessages.mock.calls[1];
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toContain(`into ${language}`);
      expect(messages[0].content).toContain("iPhone fiyatı kaç TL");
    },
  );

  it("uses a translation that ends with a line break", async () => {
    mockGenerateReplyToMessages
      .mockResolvedValueOnce("iPhone price in China")
      .mockResolvedValueOnce("iPhone 价格\n");

    expect(await generateRelatedSearchQuery([...chineseFollowUp])).toBe(
      "iPhone 价格",
    );
  });

  it("translates a query that mixes in another non-Latin script", async () => {
    mockGenerateReplyToMessages
      .mockResolvedValueOnce("iPhone قیمت大概多少钱")
      .mockResolvedValueOnce("iPhone 价格大概多少钱");

    expect(await generateRelatedSearchQuery([...chineseFollowUp])).toBe(
      "iPhone 价格大概多少钱",
    );
  });

  it("falls back to the typed question when the translation misses too", async () => {
    mockGenerateReplyToMessages
      .mockResolvedValueOnce("iPhone fiyatı kaç TL")
      .mockResolvedValueOnce("iPhone قیمت چقدر است؟");

    expect(await generateRelatedSearchQuery([...chineseFollowUp])).toBe("");
  });

  it("falls back without a translation when the script has no single language", async () => {
    mockGenerateReplyToMessages.mockResolvedValueOnce("iPhone price");

    expect(
      await generateRelatedSearchQuery([
        { role: "user", content: "сколько он стоит" },
      ]),
    ).toBe("");
    expect(mockGenerateReplyToMessages).toHaveBeenCalledTimes(1);
  });

  it("returns nothing when the generation fails", async () => {
    mockGenerateReplyToMessages.mockRejectedValueOnce(new Error("offline"));

    expect(
      await generateRelatedSearchQuery([{ role: "user", content: "hello" }]),
    ).toBe("");
  });
});
