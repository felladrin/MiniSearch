import { ARGON2_PARAMETERS } from "@shared/argon2Parameters";
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
    ...ARGON2_PARAMETERS,
    outputType: "encoded",
  });

  updateLastSearchTokenHash(newSearchTokenHash);

  addLogEntry("New search token hash generated");

  return newSearchTokenHash;
}
