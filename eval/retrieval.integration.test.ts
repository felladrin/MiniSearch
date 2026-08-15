// @vitest-environment node

/**
 * Offline retrieval eval: runs the real reranker through rankSearchResults on
 * the fixed golden set and scores the ranking with nDCG and recall against the
 * human-labeled relevant results.
 *
 * It calls rankSearchResults with preserveTopResults=true, exactly the way the
 * app does for text search (searchEndpointServerHook.ts), so the pinned-first
 * result branch is exercised. The golden set therefore includes entries whose
 * first candidate is irrelevant: that is the case where the pin costs the
 * ranking, and without it the eval could not tell a good pin from a bad one.
 *
 * This is the regression signal for changes to the reranker or to
 * rankSearchResults (the score filter, the top-result preservation, the sort).
 * Golden-set structure is validated in goldenSet.test.ts (default suite).
 *
 *   npx vitest run --config vitest.eval.config.ts retrieval
 *
 * Loads the real ONNX model, so it is excluded from the default suite and from
 * CI (which has no model on disk); it is a local signal, matching the server
 * integration-test house style.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rankSearchResults } from "../server/rankSearchResults.ts";
import {
  startRerankerService,
  stopRerankerService,
} from "../server/rerankerService.ts";
import { goldenQueries } from "./goldenSet.ts";
import { ndcgAtK, recallAtK } from "./metrics.ts";
import { K, MIN_MEAN_NDCG, MIN_MEAN_RECALL } from "./thresholds.ts";

// The floors are set in the middle of the band between a working reranker
// (0.950 / 0.981) and a no-op reranker (0.587 / 0.500) on this golden set, so
// a dead or no-op reranker fails and a working one passes with margin. The
// headroom (the working reranker clears the floors by ~0.2) is intentional:
// the reranker is a quantized ONNX graph whose scores drift and can reorder
// results across execution providers (see server/rerankerService.ts), so a
// floor pinned to the measured baseline would be flaky on a different CPU.
// Re-tune if the golden set changes substantially. The no-op ceilings that
// keep these floors falsifiable live in thresholds.ts and are pinned by
// goldenSet.test.ts.

interface PerQueryScore {
  id: string;
  ndcg: number;
  recall: number;
}

describe("retrieval eval (real reranker)", () => {
  const scores: PerQueryScore[] = [];

  beforeAll(async () => {
    await startRerankerService();
  }, 600_000);

  afterAll(async () => {
    await stopRerankerService();
  });

  for (const golden of goldenQueries) {
    it(`scores ${golden.id}`, async () => {
      const candidates: [title: string, content: string, url: string][] =
        golden.results.map(({ title, snippet, url }) => [title, snippet, url]);

      // preserveTopResults=true matches the app's text-search call.
      const ranked = await rankSearchResults(golden.query, candidates, true);
      expect(ranked.length, `${golden.id}: empty ranking`).toBeGreaterThan(0);

      // The pin is the point of the [1,3] entries: the first candidate must
      // stay first regardless of the model's scores. A floor-only assert can't
      // catch a broken pin (it would raise the mean), so pin it directly.
      expect(
        ranked[0][2],
        `${golden.id}: preserveTopResults did not pin the first candidate`,
      ).toBe(golden.results[0].url);

      const rankedUrls = ranked.map(([, , url]) => url);
      const relevantUrls = golden.relevant.map((i) => golden.results[i].url);

      const ndcg = ndcgAtK(rankedUrls, relevantUrls, K);
      const recall = recallAtK(rankedUrls, relevantUrls, K);
      // Bounds that also catch a metric regression (e.g. nDCG > 1 from a
      // duplicate url).
      expect(ndcg, `${golden.id}: nDCG out of range`).toBeGreaterThanOrEqual(0);
      expect(ndcg, `${golden.id}: nDCG out of range`).toBeLessThanOrEqual(1);
      expect(
        recall,
        `${golden.id}: recall out of range`,
      ).toBeGreaterThanOrEqual(0);
      expect(recall, `${golden.id}: recall out of range`).toBeLessThanOrEqual(
        1,
      );

      scores.push({ id: golden.id, ndcg, recall });
    }, 120_000);
  }

  it("meets the aggregate regression thresholds", () => {
    // Print the breakdown before asserting, so a per-query failure still shows
    // which queries scored what (the diagnostic you need when a regression fires).
    const meanNdcg =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + s.ndcg, 0) / scores.length
        : 0;
    const meanRecall =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + s.recall, 0) / scores.length
        : 0;

    console.table(
      scores.map((s) => ({
        id: s.id,
        [`nDCG@${K}`]: s.ndcg.toFixed(3),
        [`recall@${K}`]: s.recall.toFixed(3),
      })),
    );
    console.log(
      `mean nDCG@${K}=${meanNdcg.toFixed(3)}  mean recall@${K}=${meanRecall.toFixed(3)}`,
    );

    expect(scores).toHaveLength(goldenQueries.length);
    expect(meanNdcg, `mean nDCG@${K} regressed`).toBeGreaterThanOrEqual(
      MIN_MEAN_NDCG,
    );
    expect(meanRecall, `mean recall@${K} regressed`).toBeGreaterThanOrEqual(
      MIN_MEAN_RECALL,
    );
  });
});
