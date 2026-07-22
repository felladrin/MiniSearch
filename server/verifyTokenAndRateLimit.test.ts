import type { IncomingMessage } from "node:http";
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
    consume = vi.fn((key: string) => {
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

  it("should key rate limiter on client IP when request is provided", async () => {
    mockRateLimiterShouldFail = false;
    vi.resetModules();
    const { verifyTokenAndRateLimit } = await import(
      "./verifyTokenAndRateLimit"
    );
    const mockReq = makeMockRequest("192.168.1.100");
    const result = await verifyTokenAndRateLimit("valid-token", mockReq);
    expect(result.isAuthorized).toBe(true);
    expect(mockConsume).toHaveBeenCalledWith("192.168.1.100");
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

describe("getClientIp", () => {
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
