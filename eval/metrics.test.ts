import { describe, expect, it } from "vitest";
import { dcgAtK, ndcgAtK, rbo, recallAtK } from "./metrics.ts";

describe("dcgAtK", () => {
  it("discounts relevance by position", () => {
    // A single relevant result at rank 1 scores higher than at rank 2.
    expect(dcgAtK([1, 0], 2)).toBe(1 / Math.log2(2));
    expect(dcgAtK([0, 1], 2)).toBeCloseTo(1 / Math.log2(3));
  });

  it("ignores gains beyond k", () => {
    expect(dcgAtK([1, 1, 1], 1)).toBe(dcgAtK([1], 1));
  });
});

describe("ndcgAtK", () => {
  it("is 1 when the relevant urls occupy the top ranks", () => {
    const relevant = ["a", "b"];
    expect(ndcgAtK(["a", "b", "c"], relevant, 3)).toBeCloseTo(1);
    expect(ndcgAtK(["b", "a", "c"], relevant, 3)).toBeCloseTo(1);
  });

  it("decreases as relevant urls sink", () => {
    const relevant = ["a", "b"];
    const perfect = ndcgAtK(["a", "b", "c", "d"], relevant, 4);
    const half = ndcgAtK(["c", "a", "b", "d"], relevant, 4);
    const worst = ndcgAtK(["d", "c", "a", "b"], relevant, 4);
    expect(perfect).toBeCloseTo(1);
    expect(perfect).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(worst);
    expect(worst).toBeGreaterThan(0);
  });

  it("is 0 when no relevant url is ranked at all", () => {
    expect(ndcgAtK(["c", "d"], ["a", "b"], 2)).toBe(0);
  });

  it("scores against an ideal top-k when there are more relevant urls than k", () => {
    // Three relevant urls, k=2: ideal top-2 is two relevant urls.
    const relevant = ["a", "b", "c"];
    const topTwoRelevant = ndcgAtK(["a", "b", "c"], relevant, 2);
    const oneRelevantInTopTwo = ndcgAtK(["c", "d", "a"], relevant, 2);
    expect(topTwoRelevant).toBeCloseTo(1);
    expect(topTwoRelevant).toBeGreaterThan(oneRelevantInTopTwo);
  });

  it("is 0 when there are no relevant urls to recall", () => {
    expect(ndcgAtK(["a", "b"], [], 2)).toBe(0);
  });

  it("returns 0 for a non-positive k", () => {
    expect(ndcgAtK(["a"], ["a"], 0)).toBe(0);
  });

  it("never exceeds 1 when a url is listed twice", () => {
    // A duplicate relevant url must not earn gain twice, which would push
    // nDCG above 1 and mask a regression.
    const ndcg = ndcgAtK(["u", "u", "x"], ["u"], 3);
    expect(ndcg).toBeLessThanOrEqual(1);
    expect(ndcg).toBeGreaterThan(0);
  });
});

describe("recallAtK", () => {
  it("is the fraction of relevant urls in the top-k", () => {
    const relevant = ["a", "b", "c"];
    expect(recallAtK(["a", "b", "d"], relevant, 3)).toBeCloseTo(2 / 3);
    expect(recallAtK(["a", "b", "c", "d"], relevant, 4)).toBe(1);
  });

  it("counts a relevant url only once even if it repeats", () => {
    expect(recallAtK(["a", "a", "a"], ["a", "b"], 3)).toBeCloseTo(0.5);
  });

  it("is 0 when there are no relevant urls", () => {
    expect(recallAtK(["a"], [], 1)).toBe(0);
  });
});

describe("rbo", () => {
  it("is exactly 1 for identical lists", () => {
    // The tail extrapolation term is what brings identical finite lists to
    // the top anchor; the truncated sum alone gives 1 - p^k.
    expect(rbo(["a", "b", "c"], ["a", "b", "c"], 0.9)).toBe(1);
  });

  it("is 0 for disjoint lists", () => {
    expect(rbo(["a", "b"], ["c", "d"], 0.9)).toBe(0);
  });

  it("scores prefix agreement higher than suffix agreement", () => {
    // Same shared urls, but earlier agreement weighs more in RBO.
    const prefix = rbo(["a", "b", "c"], ["a", "b", "d"], 0.9);
    const suffix = rbo(["a", "b", "c"], ["d", "b", "c"], 0.9);
    expect(prefix).toBeGreaterThan(suffix);
  });

  it("is symmetric in its arguments", () => {
    expect(rbo(["a", "b", "c"], ["b", "c", "d"], 0.9)).toBe(
      rbo(["b", "c", "d"], ["a", "b", "c"], 0.9),
    );
    // Asymmetry is also a trap for uneven list lengths.
    expect(rbo(["a", "b"], ["a", "b", "c"], 0.9)).toBe(
      rbo(["a", "b", "c"], ["a", "b"], 0.9),
    );
  });

  it("does not double-count a duplicated url", () => {
    // The duplicate must not lift the score past the identical-list anchor
    // or change the symmetric counterpart's reading.
    const once = rbo(["a", "b"], ["a", "b"], 0.9);
    const duplicated = rbo(["a", "a", "b"], ["a", "b"], 0.9);
    expect(duplicated).toBeLessThanOrEqual(once);
  });

  it("returns 0 for two empty lists", () => {
    expect(rbo([], [], 0.9)).toBe(0);
  });

  it("returns 0 when one list is empty", () => {
    expect(rbo(["a"], [], 0.9)).toBe(0);
  });

  it("scores only rank 1 when p is 0", () => {
    // (1 - p) keeps only the d = 1 term and the tail term vanishes.
    expect(rbo(["a", "b"], ["b", "a"], 0)).toBeCloseTo(0);
    expect(rbo(["a", "b"], ["a", "x"], 0)).toBeCloseTo(1);
  });

  it("rejects p outside [0, 1)", () => {
    // p = 1 would make the (1 - p) discount factor vanish and degenerate the
    // formula, so it is rejected instead of silently mis-scored.
    expect(() => rbo(["a"], ["a"], 1)).toThrow(RangeError);
    expect(() => rbo(["a"], ["a"], -0.1)).toThrow(RangeError);
    expect(() => rbo(["a"], ["a"], 1.5)).toThrow(RangeError);
  });
});
