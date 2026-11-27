import { describe, expect, it, vi } from "vitest";
import { getFallbackProviderStats } from "./fallbackSearchService.ts";
import {
  createRequest,
  createResponse,
  type HookHandler,
} from "./hookTestUtils.ts";
import { recordModelAttempt } from "./inferencesSinceLastRestart.ts";
import {
  incrementSearchesFailedOnFallback,
  incrementSearchesServedByFallback,
} from "./searchesSinceLastRestart.ts";
import { statusEndpointServerHook } from "./statusEndpointServerHook.ts";

// The health getters probe live services; this test is about the payload,
// so they answer healthy without a network.
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
  getWebSearchServiceStatus: async () => "degraded",
  // jscpd:ignore-end
  getSearchCircuitStats: () => ({
    circuitState: "closed",
    circuitOpens: 0,
  }),
}));

/**
 * Registers the hook and sends `url` through it; returns the response and the
 * `next` it was given. Vite sets VITE_BUILD_DATE_TIME for every serve (see
 * vite.config.ts), so the fake server carries one.
 */
async function callStatus(url = "/status") {
  const use = vi.fn();
  statusEndpointServerHook({
    middlewares: { use },
    config: { define: { VITE_BUILD_DATE_TIME: new Date().toISOString() } },
  } as unknown as Parameters<typeof statusEndpointServerHook>[0]);

  const response = createResponse();
  const next = vi.fn();
  const handler = use.mock.calls[0][0] as HookHandler;

  await handler(createRequest(url), response, next);
  return { response, next };
}

/** The `/status` payload, parsed back from the body the hook wrote. */
async function statusPayload(url = "/status") {
  const { response } = await callStatus(url);
  return JSON.parse(response.end.mock.calls[0][0]) as Record<string, unknown>;
}

describe("statusEndpointServerHook", () => {
  it("serves inference.byModel as an array in the configured model order", async () => {
    vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_MODEL", "slot-one, slot-two");
    try {
      recordModelAttempt("slot-two");
      const status = await statusPayload();
      const inference = status.inference as { byModel: unknown[] };
      expect(inference.byModel).toEqual([
        { attempted: 0, streamed: 0, failed: 0, abandoned: 0 },
        { attempted: 1, streamed: 0, failed: 0, abandoned: 0 },
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(["/statuses", "/statusX?token=abc", "/status/extra"])(
    "passes through %s, which is not the /status route",
    async (url) => {
      const { response, next } = await callStatus(url);

      expect(next).toHaveBeenCalledTimes(1);
      expect(response.end).not.toHaveBeenCalled();
    },
  );

  it("still answers /status with a query string", async () => {
    const { response, next } = await callStatus("/status?probe=1");

    expect(next).not.toHaveBeenCalled();
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it("publishes the web search verdict and the per-engine tally", async () => {
    const status = await statusPayload();

    // Passed through rather than recomputed: a liveness probe reports an open
    // circuit as healthy.
    expect(status.webSearchServiceStatus).toBe("degraded");
    expect(status.searches).toMatchObject({
      degradedSearchTypes: [],
      unresponsiveEngines: {},
    });
  });

  it("publishes the two fallback counters as plain counts", async () => {
    const before = await statusPayload();

    incrementSearchesServedByFallback();
    incrementSearchesFailedOnFallback();
    incrementSearchesFailedOnFallback();

    const status = await statusPayload();

    // Exact values rather than expect.any(Number), which a pair of swapped
    // getters would satisfy too. The counters are module state that no test
    // here resets, so the deltas are what each getter moved.
    expect(status.searchesServedByFallback).toBe(
      (before.searchesServedByFallback as number) + 1,
    );
    expect(status.searchesFailedOnFallback).toBe(
      (before.searchesFailedOnFallback as number) + 2,
    );
  });

  it("publishes the per-provider fallback counters under searches", async () => {
    const status = await statusPayload();

    expect(status.searches).toMatchObject({
      fallbackProviders: getFallbackProviderStats(),
    });
    expect(
      Object.keys(
        (status.searches as { fallbackProviders: object }).fallbackProviders,
      ),
    ).toEqual(["parallel", "youcom", "keenable"]);
  });

  it("publishes the page-read circuit count beside the outcome counters", async () => {
    const status = await statusPayload();

    // Counts and nothing else: the hosts the breaker boxes come from search
    // results, so naming one here would say something about a query.
    expect(status.pageReads).toMatchObject({
      circuitOpens: expect.any(Number),
      skipped: { skippedByBreaker: expect.any(Number) },
    });
  });

  it("keeps startedAt fixed at the restart while uptime advances", async () => {
    const first = await statusPayload();
    expect(typeof first.startedAt).toBe("string");
    const startedAt = Date.parse(first.startedAt as string);
    expect(Number.isNaN(startedAt)).toBe(false);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(startedAt + 600_000);
      const later = await statusPayload();
      // The module captured its start once, on import: startedAt is the same
      // instant on every call while uptime advances. Replacing the capture
      // with a per-call Date.now() fails this.
      expect(later.startedAt).toBe(first.startedAt);
      expect(later.uptime).toBe("10 minutes");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("statusEndpointServerHook with a malformed build define", () => {
  it("answers 500 instead of rejecting the middleware", async () => {
    const use = vi.fn();
    statusEndpointServerHook({
      middlewares: { use },
      config: {
        define: {
          VITE_BUILD_DATE_TIME: new Date().toISOString(),
          VITE_COMMIT_SHORT_HASH: "{not json",
        },
      },
    } as unknown as Parameters<typeof statusEndpointServerHook>[0]);
    const response = createResponse();

    await expect(
      (use.mock.calls[0][0] as HookHandler)(
        createRequest("/status"),
        response,
        () => undefined,
      ),
    ).resolves.toBeUndefined();

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.end.mock.calls[0][0])).toEqual({
      error: "Malformed VITE_COMMIT_SHORT_HASH build define",
    });
  });
});
