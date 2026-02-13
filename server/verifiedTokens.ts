/**
 * Set of verified tokens for session management
 */
const verifiedTokens = new Set<string>();

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
