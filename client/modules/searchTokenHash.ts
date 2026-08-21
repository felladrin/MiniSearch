import { argon2id, argon2Verify } from "hash-wasm";
import { getConfig } from "./config";
import { addLogEntry } from "./logEntries";
import { getLastSearchTokenHash, updateLastSearchTokenHash } from "./pubSub";

export async function getSearchTokenHash() {
  const { searchToken: password } = await getConfig();
  const lastSearchTokenHash = getLastSearchTokenHash();

  try {
    const lastSearchTokenHashIsValid = await argon2Verify({
      password,
      hash: lastSearchTokenHash,
    });

    if (lastSearchTokenHashIsValid) {
      addLogEntry("Using cached search token hash");
      return lastSearchTokenHash;
    }
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
    // The digest is what a caller without the token would have to guess to
    // forge a `?token=`, so it sets the ceiling on forgery resistance.
    hashLength: 32,
    outputType: "encoded",
  });

  updateLastSearchTokenHash(newSearchTokenHash);

  addLogEntry("New search token hash generated");

  return newSearchTokenHash;
}
