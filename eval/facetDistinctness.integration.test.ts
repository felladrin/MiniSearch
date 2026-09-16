// @vitest-environment node

/**
 * Facet distinctness eval: for every (query, facet) pair in facetSet.ts, runs
 * the base query and the refined query (`query + " " + facet`) through the
 * real path - SearXNG fetch, then rankSearchResults with
 * preserveTopResults=true, exactly the way the app's text search does - and
 * scores the Rank-Biased Overlap (p = 0.9) between the two top-3 url lists.
 *
 * The question this answers, before any clarification UI is built: does
 * `query + facet` actually move the top results? A uniformly high RBO means
 * the facet is cosmetic and the idea dies here; low RBO means the facet
 * steers and the follow-up work is worth doing.
 *
 * This is REPORT-ONLY: it prints a per-facet table and a summary line, and a
 * human reads the verdict off it. There is deliberately no pass/fail floor on
 * RBO, and the only assertions pin the harness's own honesty (it ran, it
 * produced numeric scores, they sit in [0, 1]).
 *
 *   npm run eval:facets
 *
 * Needs SearXNG on 127.0.0.1:8888 (hardcoded in webSearchService.ts; run it
 * in the dev container) and the real ONNX model in server/models/. It sleeps
 * ~8s between every SearXNG fetch because the circuit breaker is shared and
 * hammering upstream gets the engines CAPTCHA'd, which costs the whole sweep:
 * a suspended engine pool reports no results, and every remaining pair is
 * skipped. The full sweep therefore takes ~8 minutes.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rankSearchResults } from "../server/rankSearchResults.ts";
import {
  startRerankerService,
  stopRerankerService,
} from "../server/rerankerService.ts";
import { fetchSearXNG } from "../server/webSearchService.ts";
import { type FacetQuery, facetQueries } from "./facetSet.ts";
import { rbo } from "./metrics.ts";

const P = 0.9;
const TOP = 3;
// 30 matches the app's own DEFAULT_SEARCH_LIMIT/MAX_SEARCH_LIMIT, so the
// reranker sees the same candidate pool the app's text search would give it.
const FETCH_LIMIT = 30;
// 8s, not the 500ms this started at: a sweep of 39 fetches at 500ms suspends
// Brave and DuckDuckGo about a minute in, and every pair after that is lost.
const FETCH_GAP_MS = 8000;
/** RBO below this means the facet moved the top results. Read off the table. */
const LOW_RBO = 0.5;

interface FacetScore {
  query: string;
  facet: string;
  /** The RBO, or null when the pair was skipped (see `skipped`). */
  rbo: number | null;
  skipped?: string;
}

const scored: FacetScore[] = [];

// The probe is a top-level await, not describe.skipIf: the .skipIf flag is
// evaluated at collection time, before beforeAll could run the probe, so the
// probe has to complete first and the flag be computed from its result.
type TextResult = [title: string, content: string, url: string];
// The awaited value is a text|image tuple union (the searchType literal
// widens to SearchType, so inference can't narrow it); attach .catch to the
// promise first, then cast the awaited union, mirroring the app's own
// `as TextResult[]` in searchEndpointServerHook.ts.
const probe = (await fetchSearXNG("jaguar", "text", 1).catch(
  (): TextResult[] => [],
)) as TextResult[];
const searxngUsable = probe.length > 0;
if (!searxngUsable) {
  console.log(
    "[facets] SearXNG is unavailable or returned zero results for the probe " +
      "query 'jaguar'; skipping the facet distinctness eval.",
  );
}

describe.skipIf(!searxngUsable)("(facets) facet distinctness eval", () => {
  beforeAll(async () => {
    await startRerankerService();
  }, 600_000);

  afterAll(async () => {
    await stopRerankerService();
  });

  it("reports the RBO of every (query, facet) pair", async () => {
    const fetch = async (q: string): Promise<TextResult[]> => {
      // Politeness: the SearXNG circuit breaker is shared with the app, so
      // pace the upstream fetches instead of bursting every pair at once.
      await new Promise((resolve) => setTimeout(resolve, FETCH_GAP_MS));
      // The "text" literal widens to the SearchType union, so the text
      // tuple is the actual shape here; the cast mirrors the app's own
      // `as TextResult[]` in searchEndpointServerHook.ts.
      return (await fetchSearXNG(q, "text", FETCH_LIMIT)) as TextResult[];
    };

    const runEntry = async (entry: FacetQuery): Promise<void> => {
      const base = await fetch(entry.query).catch(() => []);
      if (base.length === 0) {
        // A base query with no results gives every facet an empty baseline,
        // and scoring empty-vs-empty would read as "perfectly distinct".
        for (const facet of entry.facets) {
          scored.push({
            query: entry.query,
            facet,
            rbo: null,
            skipped: "base query returned no results",
          });
        }
        return;
      }

      const baseRanked = await rankSearchResults(entry.query, base, true);
      const baseTop = baseRanked.slice(0, TOP).map(([, , url]) => url);
      if (baseTop.length === 0) {
        for (const facet of entry.facets) {
          scored.push({
            query: entry.query,
            facet,
            rbo: null,
            skipped: "base ranking was empty",
          });
        }
        return;
      }

      for (const facet of entry.facets) {
        const refinedQuery = `${entry.query} ${facet}`;
        const refined = await fetch(refinedQuery).catch(() => []);
        // A zero-result refined query must not be scored: rbo([], ...) is 0,
        // which would read as "perfectly distinct" and poison the summary.
        if (refined.length === 0) {
          scored.push({
            query: entry.query,
            facet,
            rbo: null,
            skipped: "refined query returned no results",
          });
          continue;
        }

        const refinedRanked = await rankSearchResults(
          refinedQuery,
          refined,
          true,
        );
        const refinedTop = refinedRanked.slice(0, TOP).map(([, , url]) => url);
        if (refinedTop.length === 0) {
          scored.push({
            query: entry.query,
            facet,
            rbo: null,
            skipped: "refined ranking was empty",
          });
          continue;
        }

        // rbo takes the lists as-is: fewer than TOP urls when the ranked list
        // had fewer, with k = max(len a, len b) handled inside the metric.
        scored.push({
          query: entry.query,
          facet,
          rbo: rbo(baseTop, refinedTop, P),
        });
      }
    };

    for (const entry of facetQueries) {
      await runEntry(entry);
    }

    const scoredRows = scored.filter(
      (s): s is FacetScore & { rbo: number } => s.rbo !== null,
    );

    console.table(
      scored.map((s) => ({
        query: s.query,
        facet: s.facet,
        [`RBO(${TOP}, p=${P})`]: s.rbo === null ? s.skipped : s.rbo.toFixed(3),
      })),
    );
    const below = scoredRows.filter((s) => s.rbo < LOW_RBO).length;
    console.log(
      scoredRows.length === 0
        ? `no (query, facet) pair could be scored`
        : `${below}/${scoredRows.length} scored facets had RBO < ${LOW_RBO}` +
            ` (low = the facet moved the top-${TOP})`,
    );

    // The verdict is read off the table by a human. These asserts only pin
    // that the harness ran and is honest: at least one pair scored, every
    // score numeric and in [0, 1].
    expect(
      scoredRows.length,
      "no (query, facet) pair was scored; the harness did not run through the real path",
    ).toBeGreaterThan(0);
    for (const s of scoredRows) {
      expect(s.rbo, `${s.query} + ${s.facet}: RBO not a number`).toBeTypeOf(
        "number",
      );
      expect(
        s.rbo,
        `${s.query} + ${s.facet}: RBO out of [0, 1]`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        s.rbo,
        `${s.query} + ${s.facet}: RBO out of [0, 1]`,
      ).toBeLessThanOrEqual(1);
    }
  }, 900_000);
});
