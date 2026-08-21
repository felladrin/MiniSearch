import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import temporaryDirectory from "temp-dir";

function getSearchTokenFilePath() {
  return path.resolve(temporaryDirectory, "minisearch-token");
}

let processToken: string | null = null;

/**
 * The shared search token, generated on first use and kept across restarts with
 * 0600 permissions.
 *
 * Read once and then held for the life of the process. Reading the file on
 * every request let anything that rewrote it re-key a running server: the
 * clients holding the previous token were rejected from that moment on, and so
 * was every new page load, because the token being handed out had been captured
 * when the server started. A server that keeps its own token instead can still
 * verify the clients it handed that token to.
 */
export function getSearchToken() {
  if (processToken !== null) return processToken;

  if (!existsSync(getSearchTokenFilePath())) return regenerateSearchToken();

  processToken = readFileSync(getSearchTokenFilePath(), "utf8");

  return processToken;
}

export function regenerateSearchToken() {
  const filePath = getSearchTokenFilePath();
  const newToken = randomBytes(32).toString("hex");
  writeFileSync(filePath, newToken, { mode: 0o600 });
  // `mode` only applies when the file is created, so a token file left behind
  // by an earlier build would keep its old, world-readable permissions.
  chmodSync(filePath, 0o600);
  processToken = newToken;

  return newToken;
}

/**
 * Whether the file no longer holds the token this process verifies against,
 * which means another process rewrote it. Not a failure in itself, since this
 * server keeps serving and verifying its own token; it is the one thing that
 * explains a client being rejected while holding a token that was valid
 * somewhere else.
 */
export function hasSearchTokenFileChanged() {
  if (processToken === null) return false;

  try {
    return readFileSync(getSearchTokenFilePath(), "utf8") !== processToken;
  } catch (error) {
    void error;
    return true;
  }
}
