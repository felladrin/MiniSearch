import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockArgon2VerifyResult = true;
let mockIsVerifiedToken = false;
let mockRateLimiterShouldFail = false;
const mockAddVerifiedToken = vi.fn();
const mockConsume = vi.fn();
// Every limiter instance that a consume touches; one module should mean one.
const consumeInstances = new Set<unknown>();

vi.mock("hash-wasm", () => ({
  argon2Verify: vi.fn(() => Promise.resolve(mockArgon2VerifyResult)),
}));

vi.mock("rate-limiter-flexible", () => ({
  RateLimiterMemory: class {
    consume = vi.fn((key: string) => {
      consumeInstances.add(this);
      mockConsume(key);
      if (mockRateLimiterShouldFail) {
        return Promise.reject(new Error("Rate limit exceeded"));
      }
      return Promise.resolve(undefined);
    });
  },
}));

vi.mock("./searchToken", () => ({
  getSearchToken: vi.fn().mockReturnValue("dummy-token"),
  hasSearchTokenFileChanged: vi.fn().mockReturnValue(false),
}));

vi.mock("./verifiedTokens", () => ({
  addVerifiedToken: vi.fn((token: string) => mockAddVerifiedToken(token)),
  isVerifiedToken: vi.fn(() => mockIsVerifiedToken),
}));

function makeMockRequest(ip: string): IncomingMessage {
  return {
    headers: { "x-forwarded-for": ip },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

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
    expect(result).toEqual({
      isAuthorized: false,
      statusCode: 400,
      error: "Missing token.",
      reason: "missingToken",
    });
  });

  it("should reject invalid token", async () => {
    mockArgon2VerifyResult = false;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const result = await verifyTokenAndRateLimit("invalid-token");
    expect(result).toEqual({
      isAuthorized: false,
      statusCode: 401,
      error: "Invalid token.",
      reason: "invalidToken",
    });
  });

  it("refuses an already rejected token without a second argon2 verification", async () => {
    mockArgon2VerifyResult = false;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const hashWasm = await import("hash-wasm");
    const { getAuthorizationStats } = await import(
      "./authorizationSinceLastRestart"
    );

    const invalid = {
      isAuthorized: false,
      statusCode: 401,
      error: "Invalid token.",
      reason: "invalidToken",
    };
    const cacheHitsBefore = getAuthorizationStats().rejectedTokenCacheHits;

    expect(await verifyTokenAndRateLimit("dead-token")).toEqual(invalid);
    expect(await verifyTokenAndRateLimit("dead-token")).toEqual(invalid);

    // The first refusal pays for the verification; the repeat is a cache hit.
    expect(hashWasm.argon2Verify).toHaveBeenCalledTimes(1);
    expect(getAuthorizationStats().rejectedTokenCacheHits).toBe(
      cacheHitsBefore + 1,
    );
  });

  it("does not record a token that verifies", async () => {
    mockArgon2VerifyResult = true;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const { isRejectedToken } = await import("./rejectedTokens");

    const result = await verifyTokenAndRateLimit("live-token");
    expect(result.isAuthorized).toBe(true);
    expect(isRejectedToken("live-token")).toBe(false);
  });

  it("does not cache a token whose verification threw, so the same token verifies on the next attempt", async () => {
    mockArgon2VerifyResult = true;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const hashWasm = await import("hash-wasm");
    const searchToken = await import("./searchToken");
    const { isRejectedToken } = await import("./rejectedTokens");
    // The transient throw: the token file could not be read, not the token
    // being dead.
    vi.mocked(searchToken.getSearchToken).mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });

    const invalid = {
      isAuthorized: false,
      statusCode: 401,
      error: "Invalid token.",
      reason: "invalidToken",
    };
    expect(await verifyTokenAndRateLimit("flaky-token")).toEqual(invalid);

    // Nothing was cached, so once the read succeeds the same token verifies.
    expect((await verifyTokenAndRateLimit("flaky-token")).isAuthorized).toBe(
      true,
    );
    expect(hashWasm.argon2Verify).toHaveBeenCalledTimes(1);
    expect(isRejectedToken("flaky-token")).toBe(false);
  });

  it("does not cache a token when argon2 itself throws, as it does on an unparseable hash", async () => {
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const hashWasm = await import("hash-wasm");
    const { isRejectedToken } = await import("./rejectedTokens");
    vi.mocked(hashWasm.argon2Verify)
      .mockRejectedValueOnce(new Error("Invalid hash"))
      .mockRejectedValueOnce(new Error("Invalid hash"));

    const invalid = {
      isAuthorized: false,
      statusCode: 401,
      error: "Invalid token.",
      reason: "invalidToken",
    };
    expect(await verifyTokenAndRateLimit("not-a-hash")).toEqual(invalid);
    expect(await verifyTokenAndRateLimit("not-a-hash")).toEqual(invalid);

    // Junk costs a regex reject, not a verification, so caching it would only
    // spend a slot: it is refused again from scratch.
    expect(hashWasm.argon2Verify).toHaveBeenCalledTimes(2);
    expect(isRejectedToken("not-a-hash")).toBe(false);
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
    expect(result).toEqual({
      isAuthorized: false,
      statusCode: 429,
      error: "Too many requests.",
      reason: "rateLimited",
    });
  });

  it("should rate-limit invalid tokens instead of skipping the limiter", async () => {
    mockArgon2VerifyResult = false;
    mockRateLimiterShouldFail = true;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const result = await verifyTokenAndRateLimit("invalid-token");
    expect(result).toEqual({
      isAuthorized: false,
      statusCode: 429,
      error: "Too many requests.",
      reason: "rateLimited",
    });
  });

  it("should not run argon2 verification when the request is already rate limited", async () => {
    mockRateLimiterShouldFail = true;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const hashWasm = await import("hash-wasm");
    const result = await verifyTokenAndRateLimit("some-token");
    expect(result).toEqual({
      isAuthorized: false,
      statusCode: 429,
      error: "Too many requests.",
      reason: "rateLimited",
    });
    expect(hashWasm.argon2Verify).not.toHaveBeenCalled();
  });

  it("should rate-limit requests with a missing token", async () => {
    mockRateLimiterShouldFail = true;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const result = await verifyTokenAndRateLimit(null);
    expect(result).toEqual({
      isAuthorized: false,
      statusCode: 429,
      error: "Too many requests.",
      reason: "rateLimited",
    });
  });

  it("should key rate limiter on the socket address by default (untrusted proxy)", async () => {
    mockRateLimiterShouldFail = false;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    // makeMockRequest sets a spoofable X-Forwarded-For, but with TRUST_PROXY
    // off the real TCP peer (socket.remoteAddress) must be used instead.
    const mockReq = makeMockRequest("192.168.1.100");
    const result = await verifyTokenAndRateLimit("valid-token", mockReq);
    expect(result.isAuthorized).toBe(true);
    expect(mockConsume).toHaveBeenCalledWith("127.0.0.1");
  });

  it("should key rate limiter on the forwarded client IP when TRUST_PROXY is enabled", async () => {
    mockRateLimiterShouldFail = false;
    vi.stubEnv("TRUST_PROXY", "true");
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const mockReq = makeMockRequest("192.168.1.100");
    const result = await verifyTokenAndRateLimit("valid-token", mockReq);
    expect(result.isAuthorized).toBe(true);
    expect(mockConsume).toHaveBeenCalledWith("192.168.1.100");
    vi.unstubAllEnvs();
  });

  it("should fall back to token as rate limit key when no request", async () => {
    mockRateLimiterShouldFail = false;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const result = await verifyTokenAndRateLimit("fallback-token");
    expect(result.isAuthorized).toBe(true);
    expect(mockConsume).toHaveBeenCalledWith("fallback-token");
  });
});

describe("consumeRateLimitPoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeInstances.clear();
    mockRateLimiterShouldFail = false;
  });

  it("consumes from the limiter keyed on socket.remoteAddress when not behind a trusted proxy", async () => {
    const { consumeRateLimitPoint } = await import("./verifyTokenAndRateLimit");
    const mockReq = makeMockRequest("192.168.1.100");
    expect(await consumeRateLimitPoint(mockReq)).toBe(true);
    expect(mockConsume).toHaveBeenCalledWith("127.0.0.1");
  });

  it("reports out of budget when the limiter refuses", async () => {
    mockRateLimiterShouldFail = true;
    const { consumeRateLimitPoint } = await import("./verifyTokenAndRateLimit");
    expect(await consumeRateLimitPoint(makeMockRequest("192.168.1.100"))).toBe(
      false,
    );
  });

  it("draws from the same limiter instance and key as the search path", async () => {
    const { verifyTokenAndRateLimit, consumeRateLimitPoint } = await import(
      "./verifyTokenAndRateLimit"
    );
    const mockReq = makeMockRequest("192.168.1.100");
    await verifyTokenAndRateLimit("valid-token", mockReq);
    await consumeRateLimitPoint(mockReq);
    // Both went through the one shared limiter, keyed on the same address.
    expect(consumeInstances.size).toBe(1);
    expect(mockConsume).toHaveBeenCalledTimes(2);
    expect(mockConsume).toHaveBeenNthCalledWith(1, "127.0.0.1");
    expect(mockConsume).toHaveBeenNthCalledWith(2, "127.0.0.1");
  });
});

describe("getClientIp", () => {
  describe("when TRUST_PROXY is enabled", () => {
    beforeEach(() => {
      vi.stubEnv("TRUST_PROXY", "true");
    });

    it("should extract last (trusted) IP from X-Forwarded-For", () => {
      vi.resetModules();
      return import("./verifyTokenAndRateLimit").then(({ getClientIp }) => {
        const req = {
          headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2, 192.168.1.50" },
          socket: { remoteAddress: "127.0.0.1" },
        } as unknown as IncomingMessage;
        expect(getClientIp(req)).toBe("192.168.1.50");
      });
    });

    it("should reject spoofed leftmost X-Forwarded-For entry", () => {
      vi.resetModules();
      return import("./verifyTokenAndRateLimit").then(({ getClientIp }) => {
        const req = {
          headers: { "x-forwarded-for": "1.2.3.4, 192.168.1.50" },
          socket: { remoteAddress: "127.0.0.1" },
        } as unknown as IncomingMessage;
        expect(getClientIp(req)).toBe("192.168.1.50");
      });
    });

    it("should fall back to X-Real-IP", () => {
      vi.resetModules();
      return import("./verifyTokenAndRateLimit").then(({ getClientIp }) => {
        const req = {
          headers: { "x-real-ip": "172.16.0.1" },
          socket: { remoteAddress: "127.0.0.1" },
        } as unknown as IncomingMessage;
        expect(getClientIp(req)).toBe("172.16.0.1");
      });
    });

    it("should fall back to socket.remoteAddress", () => {
      vi.resetModules();
      return import("./verifyTokenAndRateLimit").then(({ getClientIp }) => {
        const req = {
          headers: {},
          socket: { remoteAddress: "192.168.0.1" },
        } as unknown as IncomingMessage;
        expect(getClientIp(req)).toBe("192.168.0.1");
      });
    });

    it("should reject non-IP X-Forwarded-For entries", () => {
      vi.resetModules();
      return import("./verifyTokenAndRateLimit").then(({ getClientIp }) => {
        const req = {
          headers: { "x-forwarded-for": "not-an-ip, also-not-an-ip" },
          socket: { remoteAddress: "10.0.0.5" },
        } as unknown as IncomingMessage;
        expect(getClientIp(req)).toBe("10.0.0.5");
      });
    });

    it("should handle array-valued X-Forwarded-For header", () => {
      vi.resetModules();
      return import("./verifyTokenAndRateLimit").then(({ getClientIp }) => {
        const req = {
          headers: {
            "x-forwarded-for": ["10.0.0.1", "10.0.0.2", "192.168.1.50"],
          },
          socket: { remoteAddress: "127.0.0.1" },
        } as unknown as IncomingMessage;
        expect(getClientIp(req)).toBe("192.168.1.50");
      });
    });
  });

  describe("when TRUST_PROXY is disabled (default)", () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
    });

    it("should ignore a spoofable X-Forwarded-For and use the socket address", () => {
      vi.resetModules();
      return import("./verifyTokenAndRateLimit").then(({ getClientIp }) => {
        const req = {
          headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
          socket: { remoteAddress: "10.0.0.5" },
        } as unknown as IncomingMessage;
        expect(getClientIp(req)).toBe("10.0.0.5");
      });
    });

    it("should ignore X-Real-IP and use the socket address", () => {
      vi.resetModules();
      return import("./verifyTokenAndRateLimit").then(({ getClientIp }) => {
        const req = {
          headers: { "x-real-ip": "172.16.0.1" },
          socket: { remoteAddress: "10.0.0.5" },
        } as unknown as IncomingMessage;
        expect(getClientIp(req)).toBe("10.0.0.5");
      });
    });
  });
});
