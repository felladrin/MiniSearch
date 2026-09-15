import { Agent, createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./handleTokenVerification.ts", () => ({
  handleTokenVerification: async () => ({ shouldContinue: true }),
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
describe("internalApiEndpointServerHook over a real socket", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    // With no upstream configured, a body that survives the cap still ends in
    // a deterministic 500, which is all the follow-up needs: a status, not an
    // error.
    vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL", undefined);
    vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_KEY", undefined);
    const { internalApiEndpointServerHook } = await import(
      "./internalApiEndpointServerHook.ts"
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
      internalApiEndpointServerHook({ middlewares } as never);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });

  function post(agent: Agent, payload: string | Buffer) {
    return new Promise<string>((resolve) => {
      const req = request(
        {
          port,
          method: "POST",
          path: "/inference",
          agent,
          headers: { "Content-Type": "application/json" },
        },
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

  // The body is written in chunks with a delay between them so the server's
  // 413 lands while the client is still uploading. Sending the whole body in
  // one `end()` call lands it all before the response, and the poisoned-socket
  // bug stays hidden.
  function postChunkedOversized(agent: Agent) {
    return new Promise<string>((resolve) => {
      const req = request(
        {
          port,
          method: "POST",
          path: "/inference",
          agent,
          headers: { "Content-Type": "application/json" },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(`status=${res.statusCode}`));
        },
      );
      // The socket dies mid-upload once the server drops it; that error is
      // expected, not a failure.
      req.on("error", () => {});
      void (async () => {
        const chunk = Buffer.alloc(16 * 1024, "x");
        try {
          for (let i = 0; i < 80; i++) {
            await new Promise((r) => setTimeout(r, 15));
            if (req.destroyed) break;
            req.write(chunk);
          }
          req.end();
        } catch {
          // The server dropped the socket before the upload finished.
        }
      })();
    });
  }

  it("refuses an oversized body with 413 without breaking the next request", async () => {
    // 80 x 16 KiB = 1.25 MiB, just over the 1 MiB cap: the 413 fires on the
    // 65th chunk, with 15 more still queued on the client.
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });

    try {
      expect(await postChunkedOversized(agent)).toBe("status=413");
      // A fresh connection, because the 413 told the agent not to pool the one
      // the server then dropped. Without that header the agent reuses the
      // dropped socket and this is an ECONNRESET. A valid small body ends in
      // the 500 for the missing upstream config, so a status at all proves the
      // connection survived.
      expect(
        await post(
          agent,
          JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
        ),
      ).toBe("status=500");
    } finally {
      agent.destroy();
    }
  });
});
