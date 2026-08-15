import { describe, expect, it } from "vitest";
import { goldenQueries } from "./goldenSet.ts";

/**
 * Bumped deliberately whenever the golden set grows, so an edit to the set
 * forces the author to re-read (and re-tune if needed) the thresholds in
 * retrieval.integration.test.ts.
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
    expect(g.relevant.length, `${g.id}: no relevant labels`).toBeGreaterThan(0);
    for (const i of g.relevant) {
      expect(
        i >= 0 && i < g.results.length,
        `${g.id}: relevant index ${i} out of range (0..${g.results.length - 1})`,
      ).toBe(true);
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
});
