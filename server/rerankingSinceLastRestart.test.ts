import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());

describe("reranking counters", () => {
  it("weights totals by reranks and results, retaining independent snapshots", async () => {
    const { recordRerank, getRerankingStats } = await import(
      "./rerankingSinceLastRestart.ts"
    );
    recordRerank("text", {
      considered: 10,
      kept: 2,
      durationMs: 100.4,
      usedPercentageFallback: false,
    });
    const first = getRerankingStats();
    recordRerank("text", {
      considered: 10,
      kept: 3,
      durationMs: 300.4,
      usedPercentageFallback: true,
    });
    recordRerank("images", {
      considered: 2,
      kept: 2,
      durationMs: 20.4,
      usedPercentageFallback: false,
    });

    expect(getRerankingStats()).toEqual({
      reranks: 3,
      averageMs: 140,
      considered: 22,
      kept: 7,
      keptRate: 31.8,
      fallbackApplied: 1,
      skippedUnhealthy: 0,
      failed: 0,
      byType: {
        text: {
          reranks: 2,
          averageMs: 200,
          considered: 20,
          kept: 5,
          keptRate: 25,
        },
        images: {
          reranks: 1,
          averageMs: 20,
          considered: 2,
          kept: 2,
          keptRate: 100,
        },
      },
    });
    expect(first.byType.text).toEqual({
      reranks: 1,
      averageMs: 100,
      considered: 10,
      kept: 2,
      keptRate: 20,
    });
    first.byType.images.reranks = 99;
    expect(getRerankingStats().byType.images.reranks).toBe(1);
  });
});
