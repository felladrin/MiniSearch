/**
 * The argon2id parameters every client uses when hashing search tokens and
 * access keys. The server compares the encoded hash's parameter block against
 * this value before running `argon2Verify`, so the client and server must
 * agree on these numbers.
 *
 * Bumping any of them requires a coordinated rollout: a client with different
 * parameters produces a hash the server refuses, and a server with different
 * parameters refuses every token a live client sends.
 */
export const ARGON2_PARAMETERS = {
  parallelism: 1,
  iterations: 16,
  memorySize: 512,
  hashLength: 32,
} as const;

/**
 * The prefix every encoded hash carries. Derived from `ARGON2_PARAMETERS` so
 * the server gate and the client encoder stay in sync by construction.
 */
export const ARGON2_HASH_PREFIX = `$argon2id$v=19$m=${ARGON2_PARAMETERS.memorySize},t=${ARGON2_PARAMETERS.iterations},p=${ARGON2_PARAMETERS.parallelism}$`;
