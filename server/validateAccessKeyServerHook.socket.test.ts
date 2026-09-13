import { Agent, createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("hash-wasm", () => ({ argon2Verify: async () => false }));
vi.mock("./verifyTokenAndRateLimit.ts", () => ({
  consumeRateLimitPoint: async () => true,
}));

/**
 * The body cap answers while the client is still uploading, which leaves unread
 * bytes on the socket. Only a real connection shows what that does to the next
 * request: a mocked req/res cannot desynchronise a protocol it never speaks.
 */
describe("validateAccessKeyServerHook over a real socket", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    process.env.ACCESS_KEYS = "test-key";
    const { validateAccessKeyServerHook } = await import(
      "./validateAccessKeyServerHook.ts"
    );
    server = createServer((req, res) => {
      const middlewares = {
        use: (
          handler: (req: unknown, res: unknown, next: () => void) => void,
        ) =>
          handler(req, res, () => {
            res.statusCode = 404;
            res.end();
          }),
      };
      validateAccessKeyServerHook({ middlewares } as never);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(() => server.close());

  function post(agent: Agent, payload: string | Buffer) {
    return new Promise<string>((resolve) => {
      const req = request(
        { port, method: "POST", path: "/api/validate-access-key", agent },
        (res) => {
          res.resume();
          res.on("end", () => resolve(`status=${res.statusCode}`));
        },
      );
      req.on("error", (error) =>
        resolve(`error=${(error as NodeJS.ErrnoException).code}`),
      );
      req.end(payload);
    });
  }

  it("refuses an oversized body with 413 without breaking the next request", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });

    try {
      expect(await post(agent, Buffer.alloc(64 * 1024, "x"))).toBe(
        "status=413",
      );
      // A fresh connection, because the 413 told the agent not to pool the
      // old one. Without that header the agent reuses a socket still holding
      // the flood, and this is an ECONNRESET.
      expect(await post(agent, JSON.stringify({ accessKeyHash: "x" }))).toBe(
        "status=200",
      );
    } finally {
      agent.destroy();
    }
  });
});
