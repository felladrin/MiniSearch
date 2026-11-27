import { describe, expect, it } from "vitest";
import { resolveSourceCommitHash } from "./buildSourceCommit";

const SYNCED = "01234567";
const GIT = "fedcba98";

describe("resolveSourceCommitHash", () => {
  it("prefers the synced source commit over the build's own git hash", () => {
    expect(
      resolveSourceCommitHash({ syncedCommit: `${SYNCED}\n`, gitHash: GIT }),
    ).toBe(SYNCED);
  });

  it("falls back to the build's own git hash when nothing was synced", () => {
    expect(resolveSourceCommitHash({ syncedCommit: null, gitHash: GIT })).toBe(
      GIT,
    );
    expect(
      resolveSourceCommitHash({ syncedCommit: "  \n", gitHash: GIT }),
    ).toBe(GIT);
  });

  it("keeps the length git gave the hash", () => {
    expect(resolveSourceCommitHash({ gitHash: "0123456" })).toBe("0123456");
    expect(resolveSourceCommitHash({ gitHash: "0123456789012345" })).toBe(
      "0123456789012345",
    );
  });

  it("lowercases what it reports", () => {
    expect(
      resolveSourceCommitHash({ syncedCommit: SYNCED.toUpperCase() }),
    ).toBe(SYNCED);
  });

  it("reports nothing when the build has neither", () => {
    expect(resolveSourceCommitHash({})).toBe("");
    expect(
      resolveSourceCommitHash({ syncedCommit: undefined, gitHash: "" }),
    ).toBe("");
  });

  it.each(["not a commit", "0123", "deadbeefzz"])(
    "refuses a synced file holding %j",
    (syncedCommit) => {
      // On a Space the git hash is the copy's own commit, so a file the build
      // could not read has to stop the build rather than fall back to it.
      expect(() =>
        resolveSourceCommitHash({ syncedCommit, gitHash: GIT }),
      ).toThrow(/not a commit hash/);
    },
  );
});
