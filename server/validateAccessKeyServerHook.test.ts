import { beforeEach, describe, expect, it, vi } from "vitest";

const mockArgon2Verify = vi.fn();

vi.mock("hash-wasm", () => ({
  argon2Verify: (...args: unknown[]) => mockArgon2Verify(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
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
      handler(req as never, res as never, () => {});
      // Trigger the end callback that the handler registered
      for (const cb of req.endCallbacks) {
        cb();
      }
      // argon2Verify is async, so we need to wait for it.
      setTimeout(resolve, 50);
    });

    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ valid: true }));
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
      handler(req as never, res as never, () => {});
      for (const cb of req.endCallbacks) {
        cb();
      }
      setTimeout(resolve, 50);
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
      handler(req as never, res as never, () => {});
      for (const cb of req.endCallbacks) {
        cb();
      }
      setTimeout(resolve, 50);
    });

    expect(res.statusCode).toBe(400);
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ valid: false, error: "Invalid request" }),
    );
  });
});
