import { beforeEach, describe, expect, it, vi } from "vitest";

// The counters are module state that lasts for the process, and these cases
// assert absolute values, so each one starts from a freshly imported module.
async function loadCounters() {
  vi.resetModules();
  return import("./searchesSinceLastRestart.ts");
}

describe("getSearchStats", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports 0, not NaN, before any search was timed", async () => {
    const counters = await loadCounters();

    expect(counters.getSearchStats()).toEqual({
      averageTextualMs: 0,
      averageGraphicalMs: 0,
    });
  });

  it("averages over the timed text searches, not every text search served", async () => {
    const counters = await loadCounters();

    // One search SearXNG answered in 1000 ms, and one the fallback served,
    // which has no SearXNG duration to record.
    counters.recordSearchDuration("text", 1000);
    counters.incrementTextualSearchesSinceLastRestart();
    counters.incrementTextualSearchesSinceLastRestart();

    expect(counters.getSearchStats().averageTextualMs).toBe(1000);
    expect(counters.getTextualSearchesSinceLastRestart()).toBe(2);
  });

  it("averages over the timed image searches, not every image search served", async () => {
    const counters = await loadCounters();

    counters.recordSearchDuration("images", 1000);
    counters.incrementGraphicalSearchesSinceLastRestart();
    counters.incrementGraphicalSearchesSinceLastRestart();

    expect(counters.getSearchStats().averageGraphicalMs).toBe(1000);
    expect(counters.getGraphicalSearchesSinceLastRestart()).toBe(2);
  });

  it("keeps the text and image averages apart", async () => {
    const counters = await loadCounters();

    counters.recordSearchDuration("text", 2000);
    counters.recordSearchDuration("text", 4000);
    counters.recordSearchDuration("images", 500);

    expect(counters.getSearchStats()).toEqual({
      averageTextualMs: 3000,
      averageGraphicalMs: 500,
    });
  });

  it("does not let outages pull the average toward 0", async () => {
    const counters = await loadCounters();

    // SearXNG answers 10 searches at 2000 ms, then the fallback serves 30.
    for (let i = 0; i < 10; i++) counters.recordSearchDuration("text", 2000);
    for (let i = 0; i < 40; i++)
      counters.incrementTextualSearchesSinceLastRestart();

    expect(counters.getSearchStats().averageTextualMs).toBe(2000);
  });
});
