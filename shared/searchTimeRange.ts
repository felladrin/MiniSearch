/**
 * The time-range choices the client offers, in the order the selects list them.
 * `any` is MiniSearch's own value and means no filter: it is never sent to
 * SearXNG, which only knows the four periods after it.
 */
export const searchTimeRangeOptions = [
  { value: "any", label: "Anytime" },
  { value: "day", label: "Past day" },
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "year", label: "Past year" },
] as const;

export type SearchTimeRange = (typeof searchTimeRangeOptions)[number]["value"];

/** The values SearXNG accepts for its `time_range` parameter. */
export const searxngTimeRanges = ["day", "week", "month", "year"] as const;

export type SearxngTimeRange = (typeof searxngTimeRanges)[number];

/**
 * Set to `false` on a search response whose requested time range could not be
 * applied, which happens when a fallback provider answers a text search: those
 * take only a query and a count. The header is absent when the filter was
 * applied, so an unfiltered search carries nothing new.
 */
export const SEARCH_TIME_RANGE_APPLIED_HEADER = "X-Search-Time-Range-Applied";
