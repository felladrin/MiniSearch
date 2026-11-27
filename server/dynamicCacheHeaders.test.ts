import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Every request is refused before it reaches a service, so the test needs no
// network: an unverified token, an exhausted rate limit.
vi.mock("./handleTokenVerification", () => ({
  handleTokenVerification: vi.fn(
    async (_token: unknown, response: ServerResponse) => {
      response.statusCode = 401;
      response.end("Unauthorized");
      return { shouldContinue: false };
    },
  ),
}));
vi.mock("./verifyTokenAndRateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./verifyTokenAndRateLimit")>()),
  consumeRateLimitPoint: vi.fn(async () => false),
}));
vi.mock("./fallbackSearchService", () => ({
  assertSearchFallbackConfiguration: vi.fn(),
  fetchFallbackTextResults: vi.fn(),
  isSearchFallbackEnabled: vi.fn(() => false),
  getFallbackProviderStats: vi.fn(() => ({})),
}));
// jscpd:ignore-start
// vi.mock is hoisted above the imports, so each file registers its own mocks;
// only the factory bodies could be shared, and the ones that differ do.
vi.mock("./biEncoderService.ts", () => ({
  getBiEncoderStatus: async () => true,
}));
vi.mock("./rerankerService.ts", () => ({
  getRerankerStatus: async () => true,
}));
vi.mock("./webSearchService.ts", () => ({
  getWebSearchServiceStatus: async () => "healthy",
  getSearchCircuitStats: () => ({ circuitState: "closed", circuitOpens: 0 }),
}));

// jscpd:ignore-end

import { cacheServerHook } from "./cacheServerHook";
import { configEndpointServerHook } from "./configEndpointServerHook";
import { internalApiEndpointServerHook } from "./internalApiEndpointServerHook";
import { pageContentEndpointServerHook } from "./pageContentEndpointServerHook";
import { searchEndpointServerHook } from "./searchEndpointServerHook";
import { statusEndpointServerHook } from "./statusEndpointServerHook";
import { validateAccessKeyServerHook } from "./validateAccessKeyServerHook";

type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => unknown;

let root: string;
const middlewares: Middleware[] = [];

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "dynamic-cache-"));
  mkdirSync(path.join(root, "dist", "assets"), { recursive: true });
  writeFileSync(path.join(root, "dist", "assets", "index-abc123.js"), "");

  const server = {
    middlewares: { use: (handler: Middleware) => middlewares.push(handler) },
    config: {
      root,
      build: { outDir: "dist" },
      define: { VITE_BUILD_DATE_TIME: new Date().toISOString() },
    },
  } as never;
  // The order of the preview server in vite.config.ts.
  for (const hook of [
    configEndpointServerHook,
    searchEndpointServerHook,
    pageContentEndpointServerHook,
    statusEndpointServerHook,
    cacheServerHook,
    validateAccessKeyServerHook,
    internalApiEndpointServerHook,
  ]) {
    hook(server);
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The Cache-Control a request leaves with, answered or passed through. */
function cacheControlFor(url: string, method = "GET"): Promise<unknown> {
  return new Promise((resolve) => {
    const headers = new Map<string, unknown>();
    const response = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader: (name: string, value: unknown) =>
        headers.set(name.toLowerCase(), value),
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      hasHeader: (name: string) => headers.has(name.toLowerCase()),
      removeHeader: (name: string) => headers.delete(name.toLowerCase()),
      write: () => true,
      end: () => resolve(headers.get("cache-control")),
      on: () => response,
      once: () => response,
    };
    const request = {
      url,
      method,
      headers: { host: "localhost" },
      socket: { remoteAddress: "127.0.0.1" },
      on: () => request,
      once: () => request,
    };
    let index = 0;
    const next = () => {
      const middleware = middlewares[index++];
      if (!middleware) {
        resolve(headers.get("cache-control"));
        return;
      }
      middleware(
        request as unknown as IncomingMessage,
        response as unknown as ServerResponse,
        next,
      );
    };
    next();
  });
}

describe("Cache-Control across the preview middleware stack", () => {
  it.each([
    ["/api/validate-access-key", "POST"],
    ["/inference", "GET"],
    ["/search/text?q=a&token=x", "GET"],
    ["/search/images?q=a&token=x", "GET"],
    ["/page-content?token=x", "GET"],
    ["/status", "GET"],
    ["/api/config", "GET"],
  ])("answers %s (%s) with no-store", async (url, method) => {
    expect(await cacheControlFor(url, method)).toBe("no-store");
  });

  it("leaves the static paths to the cache hook", async () => {
    expect(await cacheControlFor("/assets/index-abc123.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await cacheControlFor("/")).toBe("no-cache");
    expect(await cacheControlFor("/favicon.png")).toBe(
      "public, max-age=86400, must-revalidate",
    );
  });
});
