// @vitest-environment node

/**
 * Exercises the real bi-encoder end to end. Downloads ~460MB on first run, so
 * it is excluded from the default suite:
 *
 *   npx vitest run --config vitest.integration.config.ts biEncoder
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getBiEncoderStatus,
  scorePassages,
  startBiEncoderService,
  stopBiEncoderService,
} from "./biEncoderService";

describe("biEncoderService", () => {
  beforeAll(async () => {
    await startBiEncoderService();
  });

  afterAll(async () => {
    await stopBiEncoderService();
  });

  it("reports itself ready", async () => {
    expect(await getBiEncoderStatus()).toBe(true);
  });

  it("scores a relevant passage above an unrelated one", async () => {
    const [relevant, unrelated] = await scorePassages(
      "how to bake sourdough bread at home",
      [
        "Mix the starter with flour and water, let the dough rise overnight, then bake it in a hot Dutch oven.",
        "Antarctica has no permanent residents and its ice sheet holds most of the planet's fresh water.",
      ],
    );

    expect(relevant).toBeGreaterThan(unrelated);
    expect(relevant).toBeGreaterThan(0.3);
  });

  it("matches across languages", async () => {
    const [portuguese, unrelated] = await scorePassages(
      "what is the capital of France",
      [
        "A capital da França é Paris, situada às margens do rio Sena.",
        "Bubble sort repeatedly swaps adjacent elements until the list is ordered.",
      ],
    );

    expect(portuguese).toBeGreaterThan(unrelated);
  });

  it("returns one score per passage", async () => {
    const scores = await scorePassages("query", ["one", "two", "three"]);

    expect(scores).toHaveLength(3);
    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(-1.001);
      expect(score).toBeLessThanOrEqual(1.001);
    }
  });
});
