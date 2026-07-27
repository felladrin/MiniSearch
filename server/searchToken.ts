import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import temporaryDirectory from "temp-dir";

/**
 * Gets the file path for the search token storage
 * @returns Full path to the token file
 */
function getSearchTokenFilePath() {
  return path.resolve(temporaryDirectory, "minisearch-token");
}

/**
 * Gets the current search token, generating one if it doesn't exist
 * @returns The search token string
 */
export const getSearchToken = () => {
  if (!existsSync(getSearchTokenFilePath())) regenerateSearchToken();
  return readFileSync(getSearchTokenFilePath(), "utf8");
};

/**
 * Generates and saves a new search token
 */
export function regenerateSearchToken() {
  const filePath = getSearchTokenFilePath();
  const newToken = randomBytes(32).toString("hex");
  writeFileSync(filePath, newToken, { mode: 0o600 });
  // `mode` only applies when the file is created, so a token file left behind
  // by an earlier build would keep its old, world-readable permissions.
  chmodSync(filePath, 0o600);
}
