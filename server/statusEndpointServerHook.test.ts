import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { statusEndpointServerHook } from "./statusEndpointServerHook.ts";

// The health getters probe live services; this test is about the payload,
// so they answer healthy without a network.
vi.mock("./biEncoderService.ts", () => ({
  getBiEncoderStatus: async () => true,
}));
vi.mock("./rerankerService.ts", () => ({
  getRerankerStatus: async () => true,
}));
vi.mock("./webSearchService.ts", () => ({
  getWebSearchStatus: async () => true,
  getSearchCircuitStats: () => ({
    circuitState: "closed",
    circuitOpens: 0,
  }),
}));

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => Promise<void>;

type RecordedResponse = ServerResponse & {
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function callStatus(): Promise<Record<string, unknown>> {
  const use = vi.fn();
  // Vite sets VITE_BUILD_DATE_TIME for every serve (see vite.config.ts).
  statusEndpointServerHook({
    middlewares: { use },
    config: { define: { VITE_BUILD_DATE_TIME: new Date().toISOString() } },
  } as unknown as Parameters<typeof statusEndpointServerHook>[0]);

  const response = {
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as RecordedResponse;
  const request = {
    url: "/status",
    headers: {},
  } as unknown as IncomingMessage;

  return (use.mock.calls[0][0] as Handler)(
    request,
    response,
    () => undefined,
  ).then(() => JSON.parse(response.end.mock.calls[0][0]));
}

describe("statusEndpointServerHook", () => {
  it("keeps startedAt fixed at the restart while uptime advances", async () => {
    const first = await callStatus();
    expect(typeof first.startedAt).toBe("string");
    const startedAt = Date.parse(first.startedAt as string);
    expect(Number.isNaN(startedAt)).toBe(false);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(startedAt + 600_000);
      const later = await callStatus();
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
