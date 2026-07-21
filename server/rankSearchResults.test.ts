import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRerank = vi.fn(() => []);

vi.mock("./rerankerService", () => ({
  rerank: (...args: unknown[]) => mockRerank(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rankSearchResults", () => {
  it("should return empty array when no results provided", async () => {
    mockRerank.mockResolvedValue([]);
    const { rankSearchResults } = await import("./rankSearchResults");
    const result = await rankSearchResults("test query", []);
    expect(result).toEqual([]);
    expect(mockRerank).toHaveBeenCalledWith("test query", []);
  });

  it("should pass lowercased query and documents to rerank", async () => {
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 0.9 },
      { index: 1, relevance_score: 0.5 },
    ]);
    const { rankSearchResults } = await import("./rankSearchResults");
    await rankSearchResults("Test Query", [
      ["Title A", "Content A", "https://a.com"],
      ["Title B", "Content B", "https://b.com"],
    ]);
    expect(mockRerank).toHaveBeenCalledWith(
      "test query",
      expect.arrayContaining([
        expect.stringContaining("title a"),
        expect.stringContaining("title b"),
      ]),
    );
  });

  it("should sort results by score descending when preserveTopResults is false", async () => {
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 0.9 },
      { index: 1, relevance_score: 0.8 },
    ]);
    const { rankSearchResults } = await import("./rankSearchResults");
    const result = await rankSearchResults("query", [
      ["A", "a", "https://a.com"],
      ["B", "b", "https://b.com"],
    ]);
    // Results are sorted by score descending (A has higher score)
    expect(result[0][0]).toBe("A");
  });

  it("should preserve top result when preserveTopResults is true", async () => {
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 0.95 },
      { index: 1, relevance_score: 0.8 },
    ]);
    const { rankSearchResults } = await import("./rankSearchResults");
    const result = await rankSearchResults(
      "query",
      [
        ["Top", "top content", "https://top.com"],
        ["Other", "other content", "https://other.com"],
      ],
      true,
    );
    expect(result[0][0]).toBe("Top");
  });

  it("should return empty array when rerank returns no results", async () => {
    mockRerank.mockResolvedValue([]);
    const { rankSearchResults } = await import("./rankSearchResults");
    const result = await rankSearchResults("query", [
      ["A", "a", "https://a.com"],
    ]);
    expect(result).toEqual([]);
  });

  it("should truncate document strings to MAX_DOCUMENT_LENGTH", async () => {
    mockRerank.mockResolvedValue([{ index: 0, relevance_score: 0.9 }]);
    const { rankSearchResults } = await import("./rankSearchResults");
    const longTitle = "A".repeat(600);
    await rankSearchResults("query", [[longTitle, "short", "https://a.com"]]);
    const docs = mockRerank.mock.calls[0][1] as string[];
    expect(docs[0].length).toBeLessThanOrEqual(512);
  });

  it("should replace double quotes with single quotes in snippet", async () => {
    mockRerank.mockResolvedValue([{ index: 0, relevance_score: 0.9 }]);
    const { rankSearchResults } = await import("./rankSearchResults");
    await rankSearchResults("query", [
      ["Title", 'Content with "quotes"', "https://a.com"],
    ]);
    const docs = mockRerank.mock.calls[0][1] as string[];
    // The snippet's double quotes are replaced with single quotes
    expect(docs[0]).toContain("'quotes'");
  });
});
