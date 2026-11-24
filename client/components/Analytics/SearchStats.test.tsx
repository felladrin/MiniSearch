import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import * as historyModule from "@/modules/history";
import { historyDatabase } from "@/modules/history";
import { getSettings } from "@/modules/pubSub";
import SearchStats from "./SearchStats";

// Pin the settings the history module reads, and keep pubSub's module-level
// localStorage reads out of the test.
vi.mock("@/modules/pubSub", () => ({
  getSettings: vi.fn(() => ({
    historyAutoCleanup: false,
    historyRetentionDays: 30,
    historyMaxEntries: 500,
  })),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

/** Metric cards print the value below the label; the heatmap above it. */
const valueBelow = (label: string) =>
  screen.getByText(label).nextElementSibling?.textContent;
const valueAbove = (label: string) =>
  screen.getByText(label).previousElementSibling?.textContent;

describe("SearchStats", () => {
  let originalTimeZone: string | undefined;

  beforeEach(async () => {
    originalTimeZone = process.env.TZ;
    await historyDatabase.searches.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  it("buckets the Daily Average by local day, like the heatmap", async () => {
    process.env.TZ = "Europe/Zurich"; // UTC+1 in January
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 15, 12));

    // 00:30 and 01:30 local are 23:30 and 00:30 UTC: one local day, two UTC
    // days. The UTC check makes a silent no-op of the zone change fail loudly
    // instead of passing vacuously.
    const first = new Date(2026, 0, 15, 0, 30).getTime();
    const second = new Date(2026, 0, 15, 1, 30).getTime();
    expect(new Date(first).getUTCDate()).toBe(14);
    expect(new Date(second).getUTCDate()).toBe(15);

    await historyDatabase.searches.bulkAdd([
      { query: "first", timestamp: first },
      { query: "second", timestamp: second },
    ]);
    render(
      <MantineProvider>
        <SearchStats />
      </MantineProvider>,
    );

    await waitFor(() => expect(valueBelow("Daily Average")).toBe("2"));
    expect(valueAbove("Active days")).toBe("1");
  });
  it("counts every stored search, not only the newest 1000", async () => {
    const now = Date.now();
    // 1,500 searches over the last 20 days; the oldest 500 are the ones a
    // window of the newest 1000 drops.
    await historyDatabase.searches.bulkAdd(
      Array.from({ length: 1500 }, (_, i) => ({
        query: `query ${i}`,
        timestamp: now - (1500 - i) * ((20 * DAY_MS) / 1500),
        source: i < 500 ? "followup" : "user",
      })),
    );

    render(
      <MantineProvider>
        <SearchStats period="all" />
      </MantineProvider>,
    );

    await waitFor(() =>
      expect(valueBelow("Total Searches")).toBe((1500).toLocaleString()),
    );
    // The sources card includes the oldest entries too.
    expect(screen.getByText("500 searches")).toBeTruthy();
    expect(screen.getByText("1000 searches")).toBeTruthy();
    // So does the heatmap. The newest 1,000 of these cover about 14 days; all
    // 1,500 cover about 21 (the span plus the day it ends on).
    expect(Number(valueAbove("Active days"))).toBeGreaterThanOrEqual(20);
  });

  it("pairs each search with its own source, also when timestamps tie", async () => {
    const tied = Date.now();
    await historyDatabase.searches.bulkAdd([
      { query: "saved before sources existed", timestamp: tied },
      { query: "typed", timestamp: tied, source: "user" },
      { query: "typed again", timestamp: tied, source: "user" },
      { query: "asked after", timestamp: tied, source: "followup" },
    ]);

    render(
      <MantineProvider>
        <SearchStats period="all" />
      </MantineProvider>,
    );

    await waitFor(() => expect(valueBelow("Total Searches")).toBe("4"));
    const sourceRow = (name: string) =>
      screen.getByText(name).closest("div")?.parentElement?.textContent;
    expect(sourceRow("User")).toContain("2 searches");
    expect(sourceRow("Followup")).toContain("1 searches");
    expect(sourceRow("Unknown")).toContain("1 searches");
  });

  it("leaves IndexedDB alone while history is turned off", async () => {
    await historyDatabase.searches.add({
      query: "kept but hidden",
      timestamp: Date.now(),
    });
    const settingsMock = vi.mocked(getSettings);
    const historyOn = settingsMock.getMockImplementation();
    settingsMock.mockImplementation(
      () =>
        ({
          ...historyOn?.(),
          enableHistory: false,
        }) as ReturnType<typeof getSettings>,
    );
    const readSpy = vi.spyOn(historyModule, "getSearchActivityRecords");

    try {
      render(
        <MantineProvider>
          <SearchStats period="all" />
        </MantineProvider>,
      );

      expect(await screen.findByText("No search data available")).toBeTruthy();
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
      if (historyOn) settingsMock.mockImplementation(historyOn);
    }
  });
});
