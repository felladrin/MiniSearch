import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("verifiedTokens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts each distinct token once regardless of repeat requests", async () => {
    const { addVerifiedToken, getVerifiedTokensAmount } = await import(
      "./verifiedTokens"
    );

    addVerifiedToken("a");
    addVerifiedToken("a");
    addVerifiedToken("b");

    expect(getVerifiedTokensAmount()).toBe(2);
  });

  it("keeps the session count when idle tokens are evicted from the cache", async () => {
    const { addVerifiedToken, isVerifiedToken, getVerifiedTokensAmount } =
      await import("./verifiedTokens");

    addVerifiedToken("idle");
    expect(isVerifiedToken("idle")).toBe(true);

    // Past the idle timeout; the periodic cleanup should evict the entry.
    vi.advanceTimersByTime(31 * 60_000);

    expect(isVerifiedToken("idle")).toBe(false);
    // The count stays on a since-restart basis even after eviction.
    expect(getVerifiedTokensAmount()).toBe(1);
  });

  it("counts a returning session again after its token was evicted", async () => {
    const { addVerifiedToken, getVerifiedTokensAmount } = await import(
      "./verifiedTokens"
    );

    addVerifiedToken("returning");
    vi.advanceTimersByTime(31 * 60_000);
    addVerifiedToken("returning");

    expect(getVerifiedTokensAmount()).toBe(2);
  });

  it("keeps an actively-used token alive across the idle window", async () => {
    const { addVerifiedToken, isVerifiedToken } = await import(
      "./verifiedTokens"
    );

    addVerifiedToken("active");
    // Refresh before each cleanup tick so the token is never idle long enough.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(20 * 60_000);
      addVerifiedToken("active");
    }

    expect(isVerifiedToken("active")).toBe(true);
  });
  it("reports the sessions still in the cache apart from the cumulative count", async () => {
    const {
      addVerifiedToken,
      getActiveSessionsAmount,
      getVerifiedTokensAmount,
    } = await import("./verifiedTokens");

    const cumulativeBefore = getVerifiedTokensAmount();
    const activeBefore = getActiveSessionsAmount();

    addVerifiedToken("active-token-a");
    addVerifiedToken("active-token-b");
    addVerifiedToken("active-token-a");

    expect(getVerifiedTokensAmount()).toBe(cumulativeBefore + 2);
    expect(getActiveSessionsAmount()).toBe(activeBefore + 2);
  });
});
