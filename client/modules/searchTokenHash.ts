import { argon2id, argon2Verify } from "hash-wasm";
import { updateLastSearchTokenHash, getLastSearchTokenHash } from "./pubSub";

export async function getSearchTokenHash() {
  const password = VITE_SEARCH_TOKEN;
  const lastSearchTokenHash = getLastSearchTokenHash();

  try {
    const lastSearchTokenHashIsValid = await argon2Verify({
      password,
      hash: lastSearchTokenHash,
    });

    if (lastSearchTokenHashIsValid) return lastSearchTokenHash;
  } catch (error) {
    void error;
  }

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const newSearchTokenHash = await argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 16,
    memorySize: 512,
    hashLength: 8,
    outputType: "encoded",
  });

  updateLastSearchTokenHash(newSearchTokenHash);

  return newSearchTokenHash;
}
