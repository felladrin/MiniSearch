import { afterEach, describe, expect, it, vi } from "vitest";
import { shuffle } from "./shuffle";

/** A seeded generator (mulberry32), so the distribution check is reproducible. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe("shuffle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the same array, holding the same items", () => {
    const items = [1, 2, 3, 4, 5];

    const result = shuffle(items);

    expect(result).toBe(items);
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("leaves an empty list and a single item as they are", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(["only"])).toEqual(["only"]);
  });

  it("puts every item in every position about equally often", () => {
    vi.spyOn(Math, "random").mockImplementation(seededRandom(20261124));
    const items = ["a", "b", "c", "d"];
    const runs = 40_000;
    const counts = items.map(() => items.map(() => 0));

    for (let run = 0; run < runs; run++) {
      shuffle([...items]).forEach((item, position) => {
        counts[items.indexOf(item)][position]++;
      });
    }

    for (const itemCounts of counts) {
      for (const count of itemCounts) {
        expect(count / runs).toBeGreaterThan(0.23);
        expect(count / runs).toBeLessThan(0.27);
      }
    }
  });
});
