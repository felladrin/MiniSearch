import { describe, expect, it } from "vitest";
import { appVersion } from "@/modules/appInfo";

describe("appVersion", () => {
  it("appends the commit hash as semver build metadata when the build had one", () => {
    // vitest.config.ts defines VITE_COMMIT_SHORT_HASH as "test-hash".
    expect(appVersion).toMatch(/^\d{4}\.\d{1,2}\.\d{1,2}\+test-hash$/);
  });

  it("never leaves a dangling separator", () => {
    // A build context without a usable git repository yields an empty hash, and
    // "1.2.3+" is not a valid version string.
    expect(appVersion.endsWith("+")).toBe(false);
  });
});
