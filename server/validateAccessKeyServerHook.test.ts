import { beforeEach, describe, expect, it, vi } from "vitest";

const mockArgon2Verify = vi.fn();
const mockConsumeRateLimitPoint = vi.fn();

vi.mock("hash-wasm", () => ({
  argon2Verify: (...args: unknown[]) => mockArgon2Verify(...args),
}));

vi.mock("./verifyTokenAndRateLimit", () => ({
  consumeRateLimitPoint: (...args: unknown[]) =>
    mockConsumeRateLimitPoint(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Within budget by default; the rate-limited case opts out.
  mockConsumeRateLimitPoint.mockResolvedValue(true);
});

function makeMockRequest(
  url: string,
  method: string,
  body?: string,
): {
  url: string | undefined;
  method: string;
  headers: Record<string, string>;
  on: ReturnType<typeof vi.fn>;
  endCallbacks: Array<() => void>;
} {
  const endCallbacks: Array<() => void> = [];
  const on = vi.fn((event: string, cb: (chunk: string) => void) => {
    if (event === "data" && body) {
      cb(body);
    }
    if (event === "end") {
      endCallbacks.push(cb as () => void);
    }
  });
  return { url, method, headers: {}, on, endCallbacks };
}

function makeMockResponse() {
  const setHeader = vi.fn();
  const end = vi.fn();
  const statusCode = 200;
  return { setHeader, end, statusCode };
}

describe("validateAccessKeyServerHook", () => {
  it("should skip non-matching URLs", async () => {
    const { validateAccessKeyServerHook } = await import(
      "./validateAccessKeyServerHook"
    );
    const use = vi.fn();
    validateAccessKeyServerHook({
      middlewares: { use },
    } as never);
    const handler = use.mock.calls[0][0] as (
      req: { url: string; method: string },
      res: unknown,
      next: () => void,
    ) => void;
    const next = vi.fn();
    handler({ url: "/other", method: "POST" }, {}, next);
    expect(next).toHaveBeenCalled();
  });

  it("should skip non-POST methods", async () => {
    const { validateAccessKeyServerHook } = await import(
      "./validateAccessKeyServerHook"
    );
    const use = vi.fn();
    validateAccessKeyServerHook({
      middlewares: { use },
    } as never);
    const handler = use.mock.calls[0][0] as (
      req: { url: string; method: string },
      res: unknown,
      next: () => void,
    ) => void;
    const next = vi.fn();
    handler({ url: "/api/validate-access-key", method: "GET" }, {}, next);
    expect(next).toHaveBeenCalled();
  });

  it("should return valid: true for a matching access key", async () => {
    process.env.ACCESS_KEYS = "test-key";
    mockArgon2Verify.mockResolvedValue(true);
    const { validateAccessKeyServerHook } = await import(
      "./validateAccessKeyServerHook"
    );
    const use = vi.fn();
    validateAccessKeyServerHook({
      middlewares: { use },
    } as never);
    const handler = use.mock.calls[0][0] as (
      req: {
        url: string;
        method: string;
        on: (event: string, cb: (chunk: string) => void) => void;
      },
      res: {
        setHeader: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      },
      next: () => void,
    ) => void;

    const res = makeMockResponse();
    const req = makeMockRequest(
      "/api/validate-access-key",
      "POST",
      JSON.stringify({ accessKeyHash: "some-hash" }),
    );

    await new Promise<void>((resolve) => {
      void handler(req as never, res as never, () => {});
      // The handler consumes a rate-limit point (async) before it registers its
      // end listener, so trigger it on a later macrotask.
      setImmediate(() => {
        for (const cb of req.endCallbacks) {
          cb();
        }
        setTimeout(resolve, 50);
      });
    });

    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ valid: true }));
    // The request was within budget, so the limiter let it through.
    expect(mockConsumeRateLimitPoint).toHaveBeenCalledTimes(1);
  });

  it("responds 429 and skips the argon2 loop when the limiter refuses", async () => {
    process.env.ACCESS_KEYS = "test-key";
    mockConsumeRateLimitPoint.mockResolvedValue(false);
    const { validateAccessKeyServerHook } = await import(
      "./validateAccessKeyServerHook"
    );
    const use = vi.fn();
    validateAccessKeyServerHook({
      middlewares: { use },
    } as never);
    const handler = use.mock.calls[0][0] as (
      req: {
        url: string;
        method: string;
        on: (event: string, cb: (chunk: string) => void) => void;
      },
      res: {
        setHeader: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
        statusCode: number;
      },
      next: () => void,
    ) => void;

    const res = makeMockResponse();
    const req = makeMockRequest(
      "/api/validate-access-key",
      "POST",
      JSON.stringify({ accessKeyHash: "some-hash" }),
    );

    await new Promise<void>((resolve) => {
      handler(req as never, res as never, () => {});
      setTimeout(resolve, 50);
    });

    expect(res.statusCode).toBe(429);
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Too many requests." }),
    );
    // The limiter refused before the argon2 loop ran, so no key was verified.
    expect(mockArgon2Verify).not.toHaveBeenCalled();
  });

  it("should return valid: false when no access keys match", async () => {
    process.env.ACCESS_KEYS = "test-key";
    mockArgon2Verify.mockResolvedValue(false);
    const { validateAccessKeyServerHook } = await import(
      "./validateAccessKeyServerHook"
    );
    const use = vi.fn();
    validateAccessKeyServerHook({
      middlewares: { use },
    } as never);
    const handler = use.mock.calls[0][0] as (
      req: {
        url: string;
        method: string;
        on: (event: string, cb: (chunk: string) => void) => void;
      },
      res: {
        setHeader: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      },
      next: () => void,
    ) => void;

    const res = makeMockResponse();
    const req = makeMockRequest(
      "/api/validate-access-key",
      "POST",
      JSON.stringify({ accessKeyHash: "wrong-hash" }),
    );

    await new Promise<void>((resolve) => {
      void handler(req as never, res as never, () => {});
      setImmediate(() => {
        for (const cb of req.endCallbacks) {
          cb();
        }
        setTimeout(resolve, 50);
      });
    });

    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ valid: false }));
  });

  it("should return 400 for invalid JSON body", async () => {
    process.env.ACCESS_KEYS = "test-key";
    const { validateAccessKeyServerHook } = await import(
      "./validateAccessKeyServerHook"
    );
    const use = vi.fn();
    validateAccessKeyServerHook({
      middlewares: { use },
    } as never);
    const handler = use.mock.calls[0][0] as (
      req: {
        url: string;
        method: string;
        on: (event: string, cb: (chunk: string) => void) => void;
      },
      res: {
        setHeader: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
        statusCode: { value: number };
      },
      next: () => void,
    ) => void;

    const res = makeMockResponse();
    const req = makeMockRequest("/api/validate-access-key", "POST", "not-json");

    await new Promise<void>((resolve) => {
      void handler(req as never, res as never, () => {});
      setImmediate(() => {
        for (const cb of req.endCallbacks) {
          cb();
        }
        setTimeout(resolve, 50);
      });
    });

    expect(res.statusCode).toBe(400);
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ valid: false, error: "Invalid request" }),
    );
  });
});
