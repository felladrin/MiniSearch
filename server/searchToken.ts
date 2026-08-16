import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import temporaryDirectory from "temp-dir";

function getSearchTokenFilePath() {
  return path.resolve(temporaryDirectory, "minisearch-token");
}

/** The shared search token, generated on first use and kept across restarts with 0600 permissions. */
export const getSearchToken = () => {
  if (!existsSync(getSearchTokenFilePath())) regenerateSearchToken();
  return readFileSync(getSearchTokenFilePath(), "utf8");
};

export function regenerateSearchToken() {
  const filePath = getSearchTokenFilePath();
  const newToken = randomBytes(32).toString("hex");
  writeFileSync(filePath, newToken, { mode: 0o600 });
  // `mode` only applies when the file is created, so a token file left behind
  // by an earlier build would keep its old, world-readable permissions.
  chmodSync(filePath, 0o600);
}
