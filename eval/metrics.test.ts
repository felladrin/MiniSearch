import { describe, expect, it } from "vitest";
import { dcgAtK, ndcgAtK, recallAtK } from "./metrics";

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
