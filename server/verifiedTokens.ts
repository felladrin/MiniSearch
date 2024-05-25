const verifiedTokens = new Set<string>();

export function getVerifiedTokensAmount() {
  return verifiedTokens.size;
}

export function isVerifiedToken(token: string) {
  return verifiedTokens.has(token);
}

export function addVerifiedToken(token: string) {
  return verifiedTokens.add(token);
}
