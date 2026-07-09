import { describe, expect, it } from "vitest";
import { buildActivity, intensityLevel } from "./searchActivity";

/** Local timestamp for a given calendar day (noon avoids DST edges). */
const at = (year: number, month1: number, day: number, hour = 12) =>
  new Date(year, month1 - 1, day, hour).getTime();

const NOW = at(2026, 7, 8); // Wed, 8 Jul 2026, local noon

describe("intensityLevel", () => {
  it("returns 0 for empty days or an empty window", () => {
    expect(intensityLevel(0, 6)).toBe(0);
    expect(intensityLevel(3, 0)).toBe(0);
  });

  it("scales 1-4 relative to the busiest day", () => {
    expect(intensityLevel(1, 6)).toBe(1);
    expect(intensityLevel(6, 6)).toBe(4);
    expect(intensityLevel(3, 6)).toBe(2);
  });
});

describe("buildActivity", () => {
  const timestamps = [
    at(2026, 7, 8),
    at(2026, 7, 8), // today: 2
    at(2026, 7, 7), // 1
    at(2026, 7, 6), // 1
    at(2026, 7, 5), // 1
    at(2026, 7, 3),
    at(2026, 7, 3),
    at(2026, 7, 3), // 3
    at(2026, 7, 2), // 1
    at(2026, 6, 28), // 6 -> six entries below
    at(2026, 6, 28),
    at(2026, 6, 28),
    at(2026, 6, 28),
    at(2026, 6, 28),
    at(2026, 6, 28),
  ];

  it("clamps a short span up to the minimum window and squares off weeks", () => {
    const data = buildActivity(timestamps, NOW);
    expect(data.weeks).toBe(12);
    expect(data.columns).toHaveLength(12);
    for (const column of data.columns) {
      expect(column).toHaveLength(7);
    }
  });

  it("buckets searches onto the correct local day", () => {
    const data = buildActivity(timestamps, NOW);
    const cells = data.columns.flat();
    expect(cells.find((c) => c.date === "2026-07-08")?.count).toBe(2);
    expect(cells.find((c) => c.date === "2026-06-28")?.count).toBe(6);
    expect(cells.find((c) => c.date === "2026-07-04")?.count).toBe(0);
  });

  it("computes streaks, active days, and the busiest day", () => {
    const { stats } = buildActivity(timestamps, NOW);
    expect(stats.currentStreak).toBe(4); // Jul 5,6,7,8
    expect(stats.longestStreak).toBe(4);
    expect(stats.daysActive).toBe(7);
    expect(stats.busiestCount).toBe(6);
    expect(stats.total).toBe(15);
  });

  it("marks days after today as future filler, not zero activity", () => {
    const data = buildActivity(timestamps, NOW);
    const future = data.columns.flat().filter((c) => c.future);
    expect(future.every((c) => c.count === 0)).toBe(true);
    // Wed 8 Jul -> Thu/Fri/Sat remain in the trailing week.
    expect(future).toHaveLength(3);
  });

  it("labels the month only when it changes across columns", () => {
    const data = buildActivity(timestamps, NOW);
    const labels = data.monthLabels.filter(Boolean);
    expect(labels).toContain("Jul");
    // No month name repeats in consecutive labelled columns.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("returns an empty-but-valid grid with no searches", () => {
    const data = buildActivity([], NOW);
    expect(data.weeks).toBe(12);
    expect(data.maxCount).toBe(0);
    expect(data.stats.currentStreak).toBe(0);
    expect(data.columns.flat().every((c) => c.count === 0)).toBe(true);
  });
});
