import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path, { basename } from "node:path";
import debug from "debug";
import temporaryDirectory from "temp-dir";

const fileName = basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

function getSearchTokenFilePath() {
  return path.resolve(temporaryDirectory, "minisearch-token");
}

let processToken: string | null = null;
let tokenFileWritten = false;

/**
 * The search token this process verifies against, generated on first use and
 * written with 0600 permissions.
 *
 * Never adopted from the file. A token that survives into a published image is
 * one every container of that build shares, and anyone who pulls the image can
 * read it out of the layer, so the file is a record for the operator and for
 * `hasSearchTokenFileChanged`, not a source of truth.
 *
 * Held for the life of the process. Reading the file on every request let
 * anything that rewrote it re-key a running server: the clients holding the
 * previous token were rejected from that moment on, and so was every new page
 * load, because the token being handed out had been captured when the server
 * started. A server that keeps its own token instead can still verify the
 * clients it handed that token to.
 */
export function getSearchToken() {
  if (processToken !== null) return processToken;

  return regenerateSearchToken();
}

export function regenerateSearchToken() {
  const newToken = randomBytes(32).toString("hex");
  processToken = newToken;

  // The token lives in memory; the file is a record, not a dependency. An
  // unwritable temp directory must not take the server's auth down with it:
  // `getSearchToken()` is called inside the argon2 try in
  // `verifyTokenAndRateLimit.ts`, where a throw reads as a bad token, so
  // every request would come back 401 with nothing in the log.
  try {
    const filePath = getSearchTokenFilePath();
    writeFileSync(filePath, newToken, { mode: 0o600 });
    // `mode` only applies when the file is created, so a token file left
    // behind by an earlier build would keep its old, world-readable
    // permissions.
    chmodSync(filePath, 0o600);
    tokenFileWritten = true;
  } catch (error) {
    printMessage(
      `Could not write the search token file, serving with the in-memory token: ${error}`,
    );
  }

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

  // Nothing was ever recorded, so a read failure here says the temp directory
  // is unwritable, which the write above already reported. Claiming another
  // process rewrote the file would be the wrong story.
  if (!tokenFileWritten) return false;

  try {
    return readFileSync(getSearchTokenFilePath(), "utf8") !== processToken;
  } catch (error) {
    void error;
    return true;
  }
}
