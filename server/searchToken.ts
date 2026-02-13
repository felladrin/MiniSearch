import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  const newToken = Math.random().toString(36).substring(2);
  writeFileSync(getSearchTokenFilePath(), newToken);
}
