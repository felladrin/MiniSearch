import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { PreviewServer } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({
  healthy: true,
  durationMs: 0,
  now: 0,
  scores: [1, 9, 8.9, 8.8],
  fail: false,
}));

vi.mock("./rerankerService.ts", () => ({
  getRerankerStatus: async () => model.healthy,
  rerank: async (_query: string, documents: string[]) => {
    if (model.fail) throw new Error("fixture model failure");
    model.now += model.durationMs;
    return documents.map((_document, index) => ({
      index,
      relevance_score: model.scores[index],
    }));
  },
}));
vi.mock("./biEncoderService.ts", () => ({
  getBiEncoderStatus: async () => true,
}));
vi.mock("./webSearchService.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./webSearchService.ts")>()),
  fetchSearXNG: vi.fn(),
  getWebSearchServiceStatus: async () => "healthy",
}));

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => Promise<void>;
const textResults = [
  ["Pinned", "private snippet", "https://example.com/0"],
  ["High", "private snippet", "https://example.com/1"],
  ["Middle", "private snippet", "https://example.com/2"],
  ["Low", "private snippet", "https://example.com/3"],
] as [string, string, string][];
const imageResults = textResults.map(
  ([title, , url]) =>
    [title, `${url}.jpg`, `${url}/thumbnail`, url] as [
      string,
      string,
      string,
      string,
    ],
);
const emptyStats = {
  reranks: 0,
  averageMs: 0,
  considered: 0,
  kept: 0,
  keptRate: 0,
};
let server: ReturnType<typeof createServer>;
let baseUrl: string;

async function request(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(async () => {
  vi.resetModules();
  model.healthy = true;
  model.durationMs = 0;
  model.now = 0;
  model.fail = false;
  model.scores = [1, 9, 8.9, 8.8];
  vi.spyOn(performance, "now").mockImplementation(() => model.now);
  const { fetchSearXNG } = await import("./webSearchService.ts");
  vi.mocked(fetchSearXNG).mockImplementation(async (_query, type) =>
    type === "text" ? textResults : imageResults,
  );
  const { addVerifiedToken } = await import("./verifiedTokens.ts");
  addVerifiedToken("fixture-session");
  const { searchEndpointServerHook } = await import(
    "./searchEndpointServerHook.ts"
  );
  const { statusEndpointServerHook } = await import(
    "./statusEndpointServerHook.ts"
  );
  const handlers: Handler[] = [];
  const host = {
    middlewares: { use: (handler: Handler) => handlers.push(handler) },
    config: { define: { VITE_BUILD_DATE_TIME: "2026-09-18T00:00:00Z" } },
  } as unknown as PreviewServer;
  searchEndpointServerHook(host);
  statusEndpointServerHook(host);
  server = createServer((req, res) => {
    let index = 0;
    const next = () => {
      const handler = handlers[index++];
      if (!handler) {
        res.writeHead(404).end();
        return;
      }
      handler(req, res, next).catch(() => res.writeHead(500).end());
    };
    next();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

describe("search reranking counters through HTTP status", () => {
  it("keeps text and images separate while preserving combined totals and result order", async () => {
    model.durationMs = 100;
    expect(
      await request("/search/text?q=private-query&token=fixture-session"),
    ).toEqual([
      [...textResults[0], 1],
      [...textResults[1], 9],
      [...textResults[2], 8.9],
    ]);
    const first = (await request("/status")).reranker;
    expect(first.byType).toEqual({
      text: {
        reranks: 1,
        averageMs: 100,
        considered: 4,
        kept: 3,
        keptRate: 75,
      },
      images: emptyStats,
    });
    model.durationMs = 300;
    await request("/search/text?q=private-query&token=fixture-session");
    model.durationMs = 20;
    expect(
      await request("/search/images?q=private-query&token=fixture-session"),
    ).toEqual([imageResults[1], imageResults[2], imageResults[3]]);
    expect((await request("/status")).reranker).toEqual({
      reranks: 3,
      averageMs: 140,
      considered: 12,
      kept: 9,
      keptRate: 75,
      fallbackApplied: 0,
      skippedUnhealthy: 0,
      failed: 0,
      byType: {
        text: {
          reranks: 2,
          averageMs: 200,
          considered: 8,
          kept: 6,
          keptRate: 75,
        },
        images: {
          reranks: 1,
          averageMs: 20,
          considered: 4,
          kept: 3,
          keptRate: 75,
        },
      },
    });
  });

  it("keeps startup and empty searches at zero for both categories", async () => {
    const before = (await request("/status")).reranker;
    expect(before).toEqual({
      ...emptyStats,
      fallbackApplied: 0,
      skippedUnhealthy: 0,
      failed: 0,
      byType: { text: emptyStats, images: emptyStats },
    });
    const { fetchSearXNG } = await import("./webSearchService.ts");
    vi.mocked(fetchSearXNG).mockResolvedValue([]);
    for (const type of ["text", "images"]) {
      expect(
        await request(`/search/${type}?q=empty&token=fixture-session`),
      ).toEqual([]);
    }
    expect((await request("/status")).reranker).toEqual(before);
  });

  it("keeps unhealthy and failed counts at the top level without counting a successful rerank", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const type of ["text", "images"]) {
      model.healthy = false;
      expect(
        await request(`/search/${type}?q=unavailable&token=fixture-session`),
      ).toEqual(type === "text" ? textResults : imageResults);
      model.healthy = true;
      model.fail = true;
      expect(
        await request(`/search/${type}?q=failed&token=fixture-session`),
      ).toEqual(type === "text" ? textResults : imageResults);
      model.fail = false;
    }
    expect((await request("/status")).reranker).toEqual({
      ...emptyStats,
      fallbackApplied: 0,
      skippedUnhealthy: 2,
      failed: 2,
      byType: { text: emptyStats, images: emptyStats },
    });
  });
});
