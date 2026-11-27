import { Agent } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postThroughSocket, startHookServer } from "./hookTestUtils.ts";

vi.mock("hash-wasm", () => ({ argon2Verify: async () => false }));
vi.mock("./verifyTokenAndRateLimit.ts", () => ({
  consumeRateLimitPoint: async () => true,
}));

/**
 * The body cap answers mid-upload and drops the socket to stop reading. Only a
 * real connection shows what that costs the caller's next request: a mocked
 * req/res has no pooled connection to be dropped underneath it.
 *
 * Runs under the default jsdom environment on purpose. `node:http` works there,
 * and a per-file environment pragma cannot be used to switch it: the global
 * setup file `client/setupTests.ts` reaches for `window`, so the node
 * environment fails at import. The two `*.integration.test.ts` files escape
 * that through `vitest.integration.config.ts`, which declares no setup file,
 * but `npm test` does not run that config.
 */
describe("validateAccessKeyServerHook over a real socket", () => {
  let closeServer: () => Promise<void>;
  let port: number;
  let originalAccessKeys: string | undefined;

  beforeEach(async () => {
    originalAccessKeys = process.env.ACCESS_KEYS;
    process.env.ACCESS_KEYS = "test-key";
    const { validateAccessKeyServerHook } = await import(
      "./validateAccessKeyServerHook.ts"
    );
    const started = await startHookServer(validateAccessKeyServerHook);
    closeServer = started.close;
    port = started.port;
  });

  afterEach(async () => {
    await closeServer();
    if (originalAccessKeys === undefined) delete process.env.ACCESS_KEYS;
    else process.env.ACCESS_KEYS = originalAccessKeys;
  });

  function post(agent: Agent, payload: string | Buffer) {
    return postThroughSocket(port, "/api/validate-access-key", agent, payload);
  }

  it("refuses an oversized body with 413 without breaking the next request", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });

    try {
      expect(await post(agent, Buffer.alloc(64 * 1024, "x"))).toBe(
        "status=413",
      );
      // A fresh connection, because the 413 told the agent not to pool the one
      // the server then dropped. Without that header the agent reuses the
      // dropped socket and this is an ECONNRESET.
      expect(await post(agent, JSON.stringify({ accessKeyHash: "x" }))).toBe(
        "status=200",
      );
    } finally {
      agent.destroy();
    }
  });
});
