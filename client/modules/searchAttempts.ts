/**
 * The newest search attempt on each search run. "Regenerate response" and
 * "Retry Search" start a new attempt without changing the run id, so the run
 * id alone cannot tell a late result from the attempt that replaced it.
 */
const latestAttemptByRunId = new Map<string, number>();

export function recordSearchAttempt(searchRunId: string, attempt: number) {
  latestAttemptByRunId.set(searchRunId, attempt);
}

export function getLatestSearchAttempt(
  searchRunId: string,
): number | undefined {
  return latestAttemptByRunId.get(searchRunId);
}
