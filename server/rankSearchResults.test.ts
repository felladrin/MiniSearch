import { beforeEach, describe, expect, it, vi } from "vitest";
import type { rerank } from "./rerankerService";

const mockRerank = vi.fn<typeof rerank>();

vi.mock("./rerankerService", () => ({
  rerank: mockRerank,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rankSearchResults", () => {
  it("should return empty array when no results provided", async () => {
    mockRerank.mockResolvedValue(
      [] as { index: number; relevance_score: number }[],
    );
    const { rankSearchResults } = await import("./rankSearchResults");
    const result = await rankSearchResults("test query", []);
    expect(result).toEqual([]);
    expect(mockRerank).toHaveBeenCalledWith("test query", []);
  });

  it("should pass query and title+snippet (cased, no URL) to rerank", async () => {
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 0.9 },
      { index: 1, relevance_score: 0.5 },
    ] as { index: number; relevance_score: number }[]);
    const { rankSearchResults } = await import("./rankSearchResults");
    await rankSearchResults("Test Query", [
      ["Title A", "Content A", "https://a.com"],
      ["Title B", "Content B", "https://b.com"],
    ]);
    expect(mockRerank).toHaveBeenCalledWith(
      "Test Query",
      expect.arrayContaining(["Title A\nContent A", "Title B\nContent B"]),
    );
    const [, docs] = mockRerank.mock.calls[0];
    expect(docs.join("\n")).not.toContain("https://");
  });

  it("should sort results by score descending when preserveTopResults is false", async () => {
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 0.9 },
      { index: 1, relevance_score: 0.8 },
    ] as { index: number; relevance_score: number }[]);
    const { rankSearchResults } = await import("./rankSearchResults");
    const result = await rankSearchResults("query", [
      ["A", "a", "https://a.com"],
      ["B", "b", "https://b.com"],
    ]);
    // Results are sorted by score descending (A has higher score)
    expect(result[0][0]).toBe("A");
  });

  it("should preserve top result when preserveTopResults is true", async () => {
    // Index 0 has the LOWER score, so a plain descending sort would put
    // "Other" first; only the pin keeps "Top" first. (A vacuous version gives
    // index 0 the highest score, which plain sort satisfies too, so it would
    // pass even with the pin deleted.)
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 0.1 },
      { index: 1, relevance_score: 0.9 },
    ] as { index: number; relevance_score: number }[]);
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
    mockRerank.mockResolvedValue(
      [] as { index: number; relevance_score: number }[],
    );
    const { rankSearchResults } = await import("./rankSearchResults");
    const result = await rankSearchResults("query", [
      ["A", "a", "https://a.com"],
    ]);
    expect(result).toEqual([]);
  });

  it("should pass full document text to rerank without character truncation", async () => {
    mockRerank.mockResolvedValue([{ index: 0, relevance_score: 0.9 }] as {
      index: number;
      relevance_score: number;
    }[]);
    const { rankSearchResults } = await import("./rankSearchResults");
    const longTitle = "A".repeat(600);
    await rankSearchResults("query", [[longTitle, "short", "https://a.com"]]);
    const docs = mockRerank.mock.calls[0][1] as string[];
    // Truncation is now token-based inside the reranker, so the full document
    // reaches it; nothing is cut by character count upstream.
    expect(docs[0]).toBe(`${longTitle}\nshort`);
    expect(docs[0].length).toBeGreaterThan(512);
  });

  it("should preserve double quotes in snippet verbatim", async () => {
    mockRerank.mockResolvedValue([{ index: 0, relevance_score: 0.9 }] as {
      index: number;
      relevance_score: number;
    }[]);
    const { rankSearchResults } = await import("./rankSearchResults");
    await rankSearchResults("query", [
      ["Title", 'Content with "quotes"', "https://a.com"],
    ]);
    const docs = mockRerank.mock.calls[0][1] as string[];
    // Double quotes in the snippet are preserved (no Markdown wrapper to escape for)
    expect(docs[0]).toBe('Title\nContent with "quotes"');
  });
});
