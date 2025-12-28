import { beforeEach, describe, expect, it, vi } from "vitest";

let mockArgon2VerifyResult = true;
let mockIsVerifiedToken = false;
let mockRateLimiterShouldFail = false;
const mockAddVerifiedToken = vi.fn();
const mockConsume = vi.fn();

vi.mock("hash-wasm", () => ({
  argon2Verify: vi.fn(() => Promise.resolve(mockArgon2VerifyResult)),
}));

vi.mock("rate-limiter-flexible", () => ({
  RateLimiterMemory: class {
    consume = vi.fn((token: string) => {
      mockConsume(token);
      if (mockRateLimiterShouldFail) {
        return Promise.reject(new Error("Rate limit exceeded"));
      }
      return Promise.resolve(undefined);
    });
  },
}));

vi.mock("./searchToken", () => ({
  getSearchToken: vi.fn().mockReturnValue("dummy-token"),
}));

vi.mock("./verifiedTokens", () => ({
  addVerifiedToken: vi.fn((token: string) => mockAddVerifiedToken(token)),
  isVerifiedToken: vi.fn(() => mockIsVerifiedToken),
}));

describe("verifyTokenAndRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockArgon2VerifyResult = true;
    mockIsVerifiedToken = false;
    mockRateLimiterShouldFail = false;
  });

  it("should reject missing token", async () => {
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const result = await verifyTokenAndRateLimit(null);
    expect(result.isAuthorized).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toBe("Missing token.");
  });

  it("should reject invalid token", async () => {
    mockArgon2VerifyResult = false;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const result = await verifyTokenAndRateLimit("invalid-token");
    expect(result.isAuthorized).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toBe("Invalid token.");
  });

  it("should accept valid token and add to verified tokens", async () => {
    mockArgon2VerifyResult = true;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const result = await verifyTokenAndRateLimit("valid-token");
    expect(result.isAuthorized).toBe(true);
    expect(result).not.toHaveProperty("statusCode");
    expect(mockAddVerifiedToken).toHaveBeenCalledWith("valid-token");
  });

  it("should skip verification for already verified tokens", async () => {
    mockIsVerifiedToken = true;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const hashWasm = await import("hash-wasm");
    const result = await verifyTokenAndRateLimit("already-verified-token");
    expect(result.isAuthorized).toBe(true);
    expect(hashWasm.argon2Verify).not.toHaveBeenCalled();
  });

  it("should enforce rate limiting", async () => {
    mockRateLimiterShouldFail = true;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const result = await verifyTokenAndRateLimit("rate-limit-token");
    expect(result.isAuthorized).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.error).toBe("Too many requests.");
  });
});
