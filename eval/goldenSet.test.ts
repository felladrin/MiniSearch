import { describe, expect, it } from "vitest";
import { goldenQueries } from "./goldenSet.ts";
import { ndcgAtK, recallAtK } from "./metrics.ts";
import {
  K,
  MAX_NOOP_MEAN_NDCG,
  MAX_NOOP_MEAN_RECALL,
  MIN_MEAN_NDCG,
  MIN_MEAN_RECALL,
} from "./thresholds.ts";

/**
 * Bumped deliberately whenever the golden set grows, so an edit to the set
 * forces the author to re-read (and re-tune if needed) the thresholds in
 * thresholds.ts.
 */
const EXPECTED_QUERY_COUNT = 26;

// Sequences that String.replace treats as special. The app's getSystemPrompt
// substitutes the search results into the prompt via String.replace, and
// getFormattedSearchResults puts the title, url, and snippet of every result
// into that replacement string. A field containing one of these would silently
// corrupt the prompt (a pre-existing bug in client/modules/systemPrompt.ts).
// Rejecting them here keeps the eval from ever grading a corrupted prompt.
const REPLACE_SPECIAL_SEQUENCES = ["$&", "$`", "$'", "$$"];

/** Structural checks on the golden set so a bad entry fails loudly. */
function validateGoldenSet() {
  const seenIds = new Set<string>();
  for (const g of goldenQueries) {
    const urls = g.results.map((r) => r.url);
    const duplicate = urls.find((u, i) => urls.indexOf(u) !== i);
    expect(
      duplicate,
      `${g.id}: duplicate result url ${duplicate} (breaks the nDCG <= 1 bound)`,
    ).toBeUndefined();
    expect(g.query.length, `${g.id}: empty query`).toBeGreaterThan(0);
    expect(g.rubric.length, `${g.id}: empty rubric`).toBeGreaterThan(0);
    expect(
      g.referenceAnswer.length,
      `${g.id}: empty referenceAnswer (weakens the judge)`,
    ).toBeGreaterThan(0);
    expect(g.relevant.length, `${g.id}: no relevant labels`).toBeGreaterThan(0);
    expect(
      new Set(g.relevant).size === g.relevant.length,
      `${g.id}: duplicate relevant index (dedupes to a trivial entry)`,
    ).toBe(true);
    for (const i of g.relevant) {
      expect(
        Number.isInteger(i),
        `${g.id}: relevant index ${i} is not an integer`,
      ).toBe(true);
      expect(
        i >= 0 && i < g.results.length,
        `${g.id}: relevant index ${i} out of range (0..${g.results.length - 1})`,
      ).toBe(true);
    }
    // Retrieval falsifiability, per entry: at least one relevant result must
    // sit outside the input top-K, or a no-op reranker (which preserves input
    // order) scores this entry as well as a working one. This is the per-entry
    // form of the "stays falsifiable" aggregate below; the aggregate alone
    // would let a single degenerate entry pass silently.
    expect(
      g.relevant.some((i) => i >= K),
      `${g.id}: every relevant result sits in the input top-${K}, so a no-op reranker scores it perfectly`,
    ).toBe(true);
    // The answer eval builds the prompt from these results, but the app slices
    // to searchResultsToConsider (6) before sending it. A longer entry would
    // grade a prompt the app can never send.
    expect(
      g.results.length <= 6,
      `${g.id}: ${g.results.length} results exceeds the app's 6-result prompt budget`,
    ).toBe(true);
    for (const r of g.results) {
      expect(r.title.length, `${g.id}: empty result title`).toBeGreaterThan(0);
      expect(r.snippet.length, `${g.id}: empty result snippet`).toBeGreaterThan(
        0,
      );
      expect(r.url.length, `${g.id}: empty result url`).toBeGreaterThan(0);
    }
    for (const special of REPLACE_SPECIAL_SEQUENCES) {
      for (const r of g.results) {
        for (const field of [r.title, r.snippet, r.url]) {
          expect(
            field.includes(special),
            `${g.id}: a result field contains ${JSON.stringify(special)} (String.replace would corrupt the prompt)`,
          ).toBe(false);
        }
      }
    }
    expect(seenIds.has(g.id), `${g.id}: duplicate golden id`).toBe(false);
    seenIds.add(g.id);
  }
}

describe("golden set", () => {
  it("is well-formed", () => {
    validateGoldenSet();
  });

  it("has the expected number of queries", () => {
    expect(goldenQueries).toHaveLength(EXPECTED_QUERY_COUNT);
  });

  it("keeps the no-op ceilings below the eval's floors", () => {
    // If a ceiling reached or passed its floor, a no-op reranker would clear
    // the floor and the retrieval eval would stop being falsifiable.
    expect(MAX_NOOP_MEAN_NDCG).toBeLessThan(MIN_MEAN_NDCG);
    expect(MAX_NOOP_MEAN_RECALL).toBeLessThan(MIN_MEAN_RECALL);
  });

  it("stays falsifiable: a no-op reranker scores below the eval's floors", () => {
    // Score the golden set as a reranker that just preserves the input order
    // (the failure mode the retrieval eval exists to catch). If this mean
    // climbs to the eval's floors, the set no longer distinguishes a working
    // reranker from a dead one - usually because an entry keeps both relevant
    // results in the input top-3.
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const scored = goldenQueries.map((g) => {
      const urls = g.results.map((r) => r.url);
      const relevant = g.relevant.map((i) => urls[i]);
      return {
        ndcg: ndcgAtK(urls, relevant, K),
        recall: recallAtK(urls, relevant, K),
      };
    });

    expect(
      mean(scored.map((s) => s.ndcg)),
      "a golden entry keeps its relevant results in the input top-3",
    ).toBeLessThanOrEqual(MAX_NOOP_MEAN_NDCG);
    expect(
      mean(scored.map((s) => s.recall)),
      "a golden entry keeps its relevant results in the input top-3",
    ).toBeLessThanOrEqual(MAX_NOOP_MEAN_RECALL);
  });
});
