/** Set of verified tokens for session management. */
const verifiedTokens = new Set<string>();
const CLEANUP_INTERVAL_MS = 60_000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function cleanupVerifiedTokens(): void {
  verifiedTokens.clear();
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
  return verifiedTokens.size;
}

export function isVerifiedToken(token: string) {
  return verifiedTokens.has(token);
}

export function addVerifiedToken(token: string) {
  return verifiedTokens.add(token);
}
