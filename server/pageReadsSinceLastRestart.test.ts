import { describe, expect, it, vi } from "vitest";
import { getPageReadStats, recordPageRead } from "./pageReadsSinceLastRestart";

/**
 * The counters live for the process, so every case measures a delta rather
 * than an absolute, which is also how they are read in production.
 */
function delta(run: () => void) {
  const before = getPageReadStats();
  run();
  const after = getPageReadStats();

  return {
    requested: after.requested - before.requested,
    read: after.read - before.read,
    bodiesTruncated: after.bodiesTruncated - before.bodiesTruncated,
    excerptsTruncated: after.excerptsTruncated - before.excerptsTruncated,
    skipped: Object.fromEntries(
      Object.entries(after.skipped).map(([outcome, count]) => [
        outcome,
        count - before.skipped[outcome as keyof typeof before.skipped],
      ]),
    ),
    after,
  };
}

describe("recordPageRead", () => {
  it("counts a successful read", () => {
    const counted = delta(() =>
      recordPageRead({ outcome: "read", durationMs: 100 }),
    );

    expect(counted.requested).toBe(1);
    expect(counted.read).toBe(1);
  });

  it("counts every outcome against the total requested", () => {
    const counted = delta(() => {
      recordPageRead({ outcome: "blocked", durationMs: 1 });
      recordPageRead({ outcome: "notADocument", durationMs: 2 });
      recordPageRead({ outcome: "httpError", durationMs: 3 });
      recordPageRead({ outcome: "redirectLimit", durationMs: 4 });
      recordPageRead({ outcome: "timedOut", durationMs: 6000 });
      recordPageRead({ outcome: "tooLittleText", durationMs: 5 });
      recordPageRead({ outcome: "failed", durationMs: 6 });
    });

    expect(counted.requested).toBe(7);
    expect(counted.read).toBe(0);
    expect(counted.skipped).toEqual({
      blocked: 1,
      notADocument: 1,
      httpError: 1,
      redirectLimit: 1,
      timedOut: 1,
      tooLittleText: 1,
      failed: 1,
    });
  });

  it("keeps read plus the skipped reasons equal to requested", () => {
    const { after } = delta(() =>
      recordPageRead({ outcome: "timedOut", durationMs: 6000 }),
    );

    const accounted =
      after.read +
      Object.values(after.skipped).reduce((total, count) => total + count, 0);

    expect(accounted).toBe(after.requested);
  });

  it("counts the two truncation signals only when they happened", () => {
    const counted = delta(() => {
      recordPageRead({ outcome: "read", durationMs: 10, bodyTruncated: true });
      recordPageRead({
        outcome: "read",
        durationMs: 10,
        excerptTruncated: true,
      });
      recordPageRead({ outcome: "read", durationMs: 10 });
    });

    expect(counted.read).toBe(3);
    expect(counted.bodiesTruncated).toBe(1);
    expect(counted.excerptsTruncated).toBe(1);
  });
});

describe("getPageReadStats", () => {
  it("reports a rate and an average over everything requested", () => {
    const before = getPageReadStats();
    recordPageRead({ outcome: "read", durationMs: 300 });
    recordPageRead({ outcome: "timedOut", durationMs: 6000 });
    const after = getPageReadStats();

    expect(after.requested).toBe(before.requested + 2);
    expect(after.readRate).toBeGreaterThan(0);
    expect(after.readRate).toBeLessThanOrEqual(100);
    // A timeout is part of the cost of the feature, so it belongs in the mean.
    expect(after.averageReadMs).toBeGreaterThan(0);
  });

  it("reports zeroes rather than NaN before anything has been read", async () => {
    // A fresh module instance is the only way to see the pre-first-read state,
    // where both derived numbers divide by zero.
    vi.resetModules();
    const fresh = await import("./pageReadsSinceLastRestart");

    expect(fresh.getPageReadStats()).toMatchObject({
      requested: 0,
      read: 0,
      readRate: 0,
      averageReadMs: 0,
    });
  });
});
