import { beforeEach, describe, expect, it, vi } from "vitest";

describe("rejectedTokens", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses a token it recorded and nothing else", async () => {
    const { addRejectedToken, isRejectedToken } = await import(
      "./rejectedTokens"
    );

    expect(isRejectedToken("a")).toBe(false);
    addRejectedToken("a");
    expect(isRejectedToken("a")).toBe(true);
    expect(isRejectedToken("b")).toBe(false);
  });

  it("evicts the oldest token once the cap is reached, so the set stays bounded", async () => {
    const { addRejectedToken, isRejectedToken, MAX_REJECTED_TOKENS } =
      await import("./rejectedTokens");

    for (let i = 0; i <= MAX_REJECTED_TOKENS; i++) {
      addRejectedToken(`token-${i}`);
    }

    expect(isRejectedToken("token-0")).toBe(false);
    expect(isRejectedToken(`token-${MAX_REJECTED_TOKENS}`)).toBe(true);
  });

  it("does not evict anything when an already recorded token is recorded again at the cap", async () => {
    const { addRejectedToken, isRejectedToken, MAX_REJECTED_TOKENS } =
      await import("./rejectedTokens");

    for (let i = 0; i < MAX_REJECTED_TOKENS; i++) {
      addRejectedToken(`token-${i}`);
    }
    addRejectedToken("token-5");

    expect(isRejectedToken("token-0")).toBe(true);
    expect(isRejectedToken(`token-${MAX_REJECTED_TOKENS - 1}`)).toBe(true);
  });
});
