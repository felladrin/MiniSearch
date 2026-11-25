import { beforeEach, describe, expect, it, vi } from "vitest";

// The counters are module state that lasts for the process, and these cases
// assert absolute values, so each one starts from a freshly imported module.
async function loadCounters() {
  vi.resetModules();
  return import("./inferencesSinceLastRestart.ts");
}

describe("byModel stats", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("publishes the counters as an array in the configured model order, zero-filling models that were never tried", async () => {
    const counters = await loadCounters();
    counters.recordModelAttempt("second");
    counters.recordModelStreamed("second");

    const stats = counters.getInferenceStats(["first", "second"]);

    expect(stats.byModel).toEqual([
      { attempted: 0, streamed: 0, failed: 0, abandoned: 0 },
      { attempted: 1, streamed: 1, failed: 0, abandoned: 0 },
    ]);
  });

  it("publishes no model names, only the four counters per entry", async () => {
    const counters = await loadCounters();
    counters.recordModelAttempt("secret-model");

    const stats = counters.getInferenceStats();

    expect(stats.byModel).toHaveLength(1);
    expect(Object.keys(stats.byModel[0]).sort()).toEqual([
      "abandoned",
      "attempted",
      "failed",
      "streamed",
    ]);
  });

  it("keeps counters for a model outside the configured list instead of dropping them", async () => {
    const counters = await loadCounters();
    counters.recordModelAttempt("listed");
    counters.recordModelAttempt("unlisted");
    counters.recordModelAttempt("unlisted");

    const stats = counters.getInferenceStats(["listed"]);

    expect(stats.byModel).toEqual([
      { attempted: 1, streamed: 0, failed: 0, abandoned: 0 },
      { attempted: 2, streamed: 0, failed: 0, abandoned: 0 },
    ]);
  });

  it("lists a model named twice in the configured list once", async () => {
    const counters = await loadCounters();
    counters.recordModelAttempt("dup");

    const stats = counters.getInferenceStats(["dup", "dup"]);

    expect(stats.byModel).toHaveLength(1);
    expect(stats.byModel[0].attempted).toBe(1);
  });

  it("falls back to first-seen order when no configured order is given", async () => {
    const counters = await loadCounters();
    counters.recordModelAttempt("beta");
    counters.recordModelAttempt("alpha");
    counters.recordModelStreamed("beta");

    const stats = counters.getInferenceStats();

    expect(stats.byModel).toEqual([
      { attempted: 1, streamed: 1, failed: 0, abandoned: 0 },
      { attempted: 1, streamed: 0, failed: 0, abandoned: 0 },
    ]);
  });
});
