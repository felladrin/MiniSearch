/**
 * Set of verified tokens for session management.
 * Tokens are cleaned up every 60 seconds to prevent unbounded growth.
 */
const verifiedTokens = new Set<string>();
const CLEANUP_INTERVAL_MS = 60_000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Cleans up old entries from the verified tokens set.
 * Since tokens are short-lived (used per-request), we simply
 * clear the set periodically to prevent unbounded growth.
 */
function cleanupVerifiedTokens(): void {
  verifiedTokens.clear();
}

/**
 * Starts the periodic cleanup timer if not already running.
 */
function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupVerifiedTokens, CLEANUP_INTERVAL_MS);
  // Prevent the timer from keeping the process alive
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

// Start cleanup on module load
startCleanupTimer();

/**
 * Gets the number of verified tokens
 * @returns Number of verified tokens
 */
export function getVerifiedTokensAmount() {
  return verifiedTokens.size;
}

/**
 * Checks if a token is verified
 * @param token - Token to check
 * @returns Whether the token is verified
 */
export function isVerifiedToken(token: string) {
  return verifiedTokens.has(token);
}

/**
 * Adds a token to the verified tokens set
 * @param token - Token to add
 * @returns The Set.add result
 */
export function addVerifiedToken(token: string) {
  return verifiedTokens.add(token);
}
