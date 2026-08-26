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

  it("carries the reranker score through as a fourth tuple element", async () => {
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 9 },
      { index: 1, relevance_score: 8.9 },
      { index: 2, relevance_score: 8.8 },
    ] as { index: number; relevance_score: number }[]);
    const { rankSearchResults } = await import("./rankSearchResults");
    const result = await rankSearchResults("query", [
      ["A", "a", "https://a.com"],
      ["B", "b", "https://b.com"],
      ["C", "c", "https://c.com"],
    ]);
    // C is dropped by the score filter; the survivors keep their scores.
    expect(result).toEqual([
      ["A", "a", "https://a.com", 9],
      ["B", "b", "https://b.com", 8.9],
    ]);
  });

  it("carries the score through when preserving the top result", async () => {
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 1 },
      { index: 1, relevance_score: 9 },
      { index: 2, relevance_score: 8.9 },
      { index: 3, relevance_score: 8.8 },
    ] as { index: number; relevance_score: number }[]);
    const { rankSearchResults } = await import("./rankSearchResults");
    const result = await rankSearchResults(
      "query",
      [
        ["Top", "top", "https://top.com"],
        ["A", "a", "https://a.com"],
        ["B", "b", "https://b.com"],
        ["C", "c", "https://c.com"],
      ],
      true,
    );
    // The pinned top result keeps its own (lowest) score, and every survivor
    // carries its score as the fourth element.
    expect(result).toEqual([
      ["Top", "top", "https://top.com", 1],
      ["A", "a", "https://a.com", 9],
      ["B", "b", "https://b.com", 8.9],
    ]);
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
  it("counts one rerank per ranked batch, and none for an empty one", async () => {
    const { getRerankingStats } = await import("./rerankingSinceLastRestart");
    const { rankSearchResults } = await import("./rankSearchResults");
    const results: [string, string, string][] = [
      ["A", "a", "https://a.com"],
      ["B", "b", "https://b.com"],
    ];
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 9 },
      { index: 1, relevance_score: 8 },
    ] as { index: number; relevance_score: number }[]);

    const before = getRerankingStats();
    await rankSearchResults("test", results);
    await rankSearchResults("test", results, true);

    expect(getRerankingStats().reranks).toBe(before.reranks + 2);

    // Reranking nothing is not a rerank: a search with no results still
    // reaches here, and counting it would pull the average toward zero.
    mockRerank.mockResolvedValue(
      [] as { index: number; relevance_score: number }[],
    );
    await rankSearchResults("test", []);

    expect(getRerankingStats().reranks).toBe(before.reranks + 2);
  });

  it("counts the results the score filter considered and kept", async () => {
    const { getRerankingStats } = await import("./rerankingSinceLastRestart");
    const { rankSearchResults } = await import("./rankSearchResults");
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 9 },
      { index: 1, relevance_score: 8.9 },
      { index: 2, relevance_score: 8.8 },
    ] as { index: number; relevance_score: number }[]);

    const before = getRerankingStats();
    const ranked = await rankSearchResults("test", [
      ["A", "a", "https://a.com"],
      ["B", "b", "https://b.com"],
      ["C", "c", "https://c.com"],
    ]);
    const after = getRerankingStats();

    // Counts, not just the ratio: the ratio alone passes for any
    // implementation that returns a percentage.
    expect(after.considered).toBe(before.considered + 3);
    expect(after.kept).toBe(before.kept + ranked.length);
  });

  it("reports how many results survived the score filter", async () => {
    const { getRerankingStats } = await import("./rerankingSinceLastRestart");
    const before = getRerankingStats();
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 9 },
      { index: 1, relevance_score: 8.5 },
      { index: 2, relevance_score: 8.4 },
    ] as { index: number; relevance_score: number }[]);
    const { rankSearchResults } = await import("./rankSearchResults");

    const ranked = await rankSearchResults("test", [
      ["A", "a", "https://a.com"],
      ["B", "b", "https://b.com"],
      ["C", "c", "https://c.com"],
    ]);

    const after = getRerankingStats();
    expect(after.reranks).toBe(before.reranks + 1);
    expect(ranked.length).toBeGreaterThan(0);
    // keptRate is a share of everything considered so far, so the only safe
    // assertion across a shared counter is that it stayed a percentage.
    expect(after.keptRate).toBeGreaterThan(0);
    expect(after.keptRate).toBeLessThanOrEqual(100);
  });

  it("reports the percentage fallback when the deviation filter empties a batch", async () => {
    const { getRerankingStats } = await import("./rerankingSinceLastRestart");
    const before = getRerankingStats();
    // One result far above a long tail: the standard-deviation threshold keeps
    // too few, so the percentage fallback has to rescue the batch.
    mockRerank.mockResolvedValue([
      { index: 0, relevance_score: 100 },
      ...Array.from({ length: 9 }, (_unused, index) => ({
        index: index + 1,
        relevance_score: 0,
      })),
    ] as { index: number; relevance_score: number }[]);
    const { rankSearchResults } = await import("./rankSearchResults");

    await rankSearchResults(
      "test",
      Array.from({ length: 10 }, (_unused, index) => [
        `T${index}`,
        `C${index}`,
        `https://${index}.com`,
      ]) as [string, string, string][],
    );

    expect(getRerankingStats().fallbackApplied).toBe(
      before.fallbackApplied + 1,
    );
  });
});
