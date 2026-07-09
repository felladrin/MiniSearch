/**
 * Builds a GitHub-style contribution heatmap from search timestamps.
 *
 * Days are bucketed by the viewer's local calendar day (matching
 * `formatRelativeTime` and the hour math in SearchStats). The grid is a
 * rolling window of whole weeks ending on the week that contains "today",
 * with columns laid out Sunday-first like GitHub's calendar.
 */

const MIN_WEEKS = 12;
const MAX_WEEKS = 26;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface DayCell {
  /** Local calendar day as YYYY-MM-DD. */
  date: string;
  count: number;
  /** Filler day after "today" that only exists to square off the last week. */
  future: boolean;
}

export interface ActivityStats {
  total: number;
  daysActive: number;
  busiestCount: number;
  /** Consecutive days with activity ending today (0 if today is empty). */
  currentStreak: number;
  longestStreak: number;
}

export interface ActivityData {
  /** Column-major: each column is a Sunday..Saturday array of 7 cells. */
  columns: DayCell[][];
  /** Per-column month label; empty string unless a new month starts there. */
  monthLabels: string[];
  stats: ActivityStats;
  /** Highest single-day count in the window; used to scale color intensity. */
  maxCount: number;
  weeks: number;
}

function startOfDay(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

function localKey(d: Date): string {
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Maps a day's count to an intensity level 0-4 relative to the busiest day.
 * @param count - Searches on the day
 * @param maxCount - Busiest single-day count in the window
 * @returns 0 (empty) through 4 (most intense)
 */
export function intensityLevel(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) return 0;
  return Math.min(4, Math.ceil((count / maxCount) * 4));
}

/**
 * Builds the heatmap grid and summary stats from raw search timestamps.
 * @param timestamps - Search timestamps in milliseconds (any order)
 * @param now - Reference "today" timestamp (defaults to current time)
 * @returns Grid columns, month labels, and streak/activity stats
 */
export function buildActivity(
  timestamps: number[],
  now: number = Date.now(),
): ActivityData {
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const key = localKey(startOfDay(ts));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const today = startOfDay(now);

  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - today.getDay());

  const oldest = timestamps.length
    ? startOfDay(Math.min(...timestamps))
    : today;
  const oldestSunday = new Date(oldest);
  oldestSunday.setDate(oldest.getDate() - oldest.getDay());

  let weeksSpan = 1;
  const cursor = new Date(oldestSunday);
  while (cursor < lastSunday) {
    cursor.setDate(cursor.getDate() + 7);
    weeksSpan += 1;
  }
  const weeks = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, weeksSpan));

  const gridStart = new Date(lastSunday);
  gridStart.setDate(lastSunday.getDate() - (weeks - 1) * 7);

  const todayTime = today.getTime();
  const columns: DayCell[][] = [];
  const monthLabels: string[] = [];
  const series: number[] = [];
  let maxCount = 0;

  const day = new Date(gridStart);
  let previousMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const column: DayCell[] = [];
    monthLabels.push("");
    for (let dow = 0; dow < 7; dow++) {
      if (dow === 0) {
        monthLabels[w] =
          day.getMonth() === previousMonth ? "" : MONTH_NAMES[day.getMonth()];
        previousMonth = day.getMonth();
      }
      const key = localKey(day);
      const count = counts.get(key) ?? 0;
      const future = day.getTime() > todayTime;
      column.push({ date: key, count, future });
      if (!future) {
        series.push(count);
        if (count > maxCount) maxCount = count;
      }
      day.setDate(day.getDate() + 1);
    }
    columns.push(column);
  }

  let total = 0;
  let daysActive = 0;
  let longestStreak = 0;
  let run = 0;
  for (const count of series) {
    total += count;
    if (count > 0) {
      daysActive += 1;
      run += 1;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }

  let currentStreak = 0;
  for (let i = series.length - 1; i >= 0 && series[i] > 0; i--) {
    currentStreak += 1;
  }

  return {
    columns,
    monthLabels,
    stats: {
      total,
      daysActive,
      busiestCount: maxCount,
      currentStreak,
      longestStreak,
    },
    maxCount,
    weeks,
  };
}
