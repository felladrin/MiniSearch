/**
 * The query the URL currently belongs to: the one whose auto-search already
 * ran, or that was just submitted or restored from history. Module-level so
 * it survives the remount when MainPage swaps HomePage for SearchForm as the
 * query goes from empty to non-empty. Kept as a single slot (not a Set) so it
 * suppresses only the most recent auto-search, matching the behavior the
 * user expects when navigating back to a previously searched query.
 */
let handledQuery: string | null = null;

export function markQueryAsHandled(query: string): void {
  handledQuery = query.trim();
}

export function isQueryHandled(query: string): boolean {
  return query.trim() === handledQuery;
}

/** Exposed for tests to reset module state between runs. */
export function resetHandledQuery(): void {
  handledQuery = null;
}
