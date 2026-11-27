import { describe, expect, it } from "vitest";
import { resolveSourceCommitHash } from "./buildSourceCommit";

const FULL = "0123456789abcdef0123456789abcdef01234567";
const OTHER_FULL = "fedcba9876543210fedcba9876543210fedcba98";

describe("resolveSourceCommitHash", () => {
  it("shortens the synced source commit", () => {
    expect(resolveSourceCommitHash({ syncedCommit: `${FULL}\n` })).toBe(
      "0123456",
    );
  });

  it("prefers the synced source commit over the build's own git hash", () => {
    expect(
      resolveSourceCommitHash({
        syncedCommit: FULL,
        gitHash: "fedcba9",
      }),
    ).toBe("0123456");
  });

  it("falls back to the build's own git hash when nothing was synced", () => {
    expect(
      resolveSourceCommitHash({ syncedCommit: null, gitHash: OTHER_FULL }),
    ).toBe("fedcba9");
  });

  it.each([
    ["", FULL],
    ["   ", FULL],
    ["not a commit", FULL],
    ["0123", FULL],
  ])(
    "ignores a synced value of %j and reports the git hash",
    (synced, gitHash) => {
      expect(resolveSourceCommitHash({ syncedCommit: synced, gitHash })).toBe(
        "0123456",
      );
    },
  );

  it("lowercases what it reports", () => {
    expect(resolveSourceCommitHash({ syncedCommit: FULL.toUpperCase() })).toBe(
      "0123456",
    );
  });

  it("reports nothing when the build has neither", () => {
    expect(resolveSourceCommitHash({})).toBe("");
    expect(
      resolveSourceCommitHash({ syncedCommit: undefined, gitHash: "" }),
    ).toBe("");
  });
});
