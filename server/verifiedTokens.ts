/** Verified tokens mapped to the time they were last seen, used to skip re-verifying repeat requests. */
const verifiedTokens = new Map<string, number>();

/** A token idle for longer than this is dropped from the cache, bounding memory; a request after that starts a new session. */
const SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;
const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Distinct sessions seen since the server started. Kept separate from the
 * cache above so the count survives idle tokens being evicted, staying on the
 * same "since restart" basis as the search counters it is averaged against.
 */
let sessionCount = 0;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function cleanupVerifiedTokens(): void {
  const now = Date.now();
  for (const [token, lastSeen] of verifiedTokens) {
    if (now - lastSeen > SESSION_IDLE_TIMEOUT_MS) verifiedTokens.delete(token);
  }
}

function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupVerifiedTokens, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

startCleanupTimer();

export function getVerifiedTokensAmount() {
  return sessionCount;
}

/**
 * Sessions still in the cache, which is the number of people the instance is
 * serving right now. `getVerifiedTokensAmount` is the cumulative one, and the
 * two together say whether a busy day was many short visits or a few long ones.
 */
export function getActiveSessionsAmount() {
  return verifiedTokens.size;
}

export function isVerifiedToken(token: string) {
  return verifiedTokens.has(token);
}

export function addVerifiedToken(token: string) {
  if (!verifiedTokens.has(token)) sessionCount++;
  verifiedTokens.set(token, Date.now());
}
