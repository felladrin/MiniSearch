import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./handleTokenVerification", () => ({
  handleTokenVerification: vi.fn(),
}));

vi.mock("./rankSearchResults", () => ({
  rankSearchResults: vi.fn(),
}));

vi.mock("./rerankerService", () => ({
  getRerankerStatus: vi.fn(),
}));

vi.mock("./searchesSinceLastRestart", () => ({
  incrementTextualSearchesSinceLastRestart: vi.fn(),
  incrementGraphicalSearchesSinceLastRestart: vi.fn(),
}));

vi.mock("./webSearchService", () => ({
  fetchSearXNG: vi.fn(),
}));

import { handleTokenVerification } from "./handleTokenVerification";
import { rankSearchResults } from "./rankSearchResults";
import { getRerankerStatus } from "./rerankerService";
import { searchEndpointServerHook } from "./searchEndpointServerHook";
import {
  incrementGraphicalSearchesSinceLastRestart,
  incrementTextualSearchesSinceLastRestart,
} from "./searchesSinceLastRestart";
import { fetchSearXNG } from "./webSearchService";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createRequest(url: string): IncomingMessage {
  return {
    url,
    headers: { host: "localhost:3000" },
  } as unknown as IncomingMessage;
}

function createResponse() {
  return {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & {
    setHeader: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

function getRegisteredHandler() {
  const use = vi.fn();
  searchEndpointServerHook({
    middlewares: { use },
  } as unknown as Parameters<typeof searchEndpointServerHook>[0]);
  return use.mock.calls[0][0] as (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => Promise<void>;
}

describe("searchEndpointServerHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: true,
    });
    vi.mocked(getRerankerStatus).mockResolvedValue(false);
    vi.mocked(rankSearchResults).mockImplementation(
      async (_query, results) => results,
    );
  });

  it("passes through requests that aren't under /search/", async () => {
    const handler = getRegisteredHandler();
    const next = vi.fn();

    await handler(createRequest("/status"), createResponse(), next);

    expect(next).toHaveBeenCalled();
    expect(fetchSearXNG).not.toHaveBeenCalled();
  });

  it("responds 400 when the query parameter is missing", async () => {
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(createRequest("/search/text?token=abc"), response, vi.fn());

    expect(response.statusCode).toBe(400);
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Missing query parameter" }),
    );
    expect(fetchSearXNG).not.toHaveBeenCalled();
  });

  it("stops processing when token verification fails", async () => {
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: false,
    });
    const handler = getRegisteredHandler();

    await handler(
      createRequest("/search/text?q=cats&token=bad"),
      createResponse(),
      vi.fn(),
    );

    expect(fetchSearXNG).not.toHaveBeenCalled();
  });

  it("returns ranked text results and increments the textual search counter", async () => {
    vi.mocked(fetchSearXNG).mockResolvedValue([
      ["Title", "Snippet", "https://example.com"],
    ]);
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest("/search/text?q=cats&token=abc"),
      response,
      vi.fn(),
    );

    expect(fetchSearXNG).toHaveBeenCalledWith("cats", "text", 30);
    expect(incrementTextualSearchesSinceLastRestart).toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json",
    );
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify([["Title", "Snippet", "https://example.com"]]),
    );
  });

  it("reranks results when the reranker is healthy and returns its reordered output", async () => {
    vi.mocked(fetchSearXNG).mockResolvedValue([
      ["A", "snippet a", "https://a.com"],
      ["B", "snippet b", "https://b.com"],
    ]);
    vi.mocked(getRerankerStatus).mockResolvedValue(true);
    vi.mocked(rankSearchResults).mockResolvedValue([
      ["B", "snippet b", "https://b.com"],
      ["A", "snippet a", "https://a.com"],
    ]);

    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest("/search/text?q=test&token=abc&limit=5"),
      response,
      vi.fn(),
    );

    expect(fetchSearXNG).toHaveBeenCalledWith("test", "text", 5);
    expect(rankSearchResults).toHaveBeenCalledWith(
      "test",
      [
        ["A", "snippet a", "https://a.com"],
        ["B", "snippet b", "https://b.com"],
      ],
      true,
    );
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify([
        ["B", "snippet b", "https://b.com"],
        ["A", "snippet a", "https://a.com"],
      ]),
    );
  });

  it("returns image results with thumbnails converted to data URLs and increments the graphical counter", async () => {
    vi.mocked(fetchSearXNG).mockResolvedValue([
      [
        "Cat picture",
        "https://example.com/cat.jpg",
        "https://thumb.example.com/cat.jpg",
        "https://example.com/cat",
      ],
    ]);
    mockFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest("/search/images?q=cats&token=abc"),
      response,
      vi.fn(),
    );

    expect(incrementGraphicalSearchesSinceLastRestart).toHaveBeenCalled();
    const [body] = response.end.mock.calls[0];
    expect(JSON.parse(body)).toEqual([
      [
        "Cat picture",
        "https://example.com/cat.jpg",
        `data:image/jpeg;base64,${Buffer.from([1, 2, 3]).toString("base64")}`,
        "https://example.com/cat",
      ],
    ]);
  });

  it("drops image results whose thumbnail fails to download", async () => {
    vi.mocked(fetchSearXNG).mockResolvedValue([
      [
        "Cat picture",
        "https://example.com/cat.jpg",
        "https://thumb.example.com/cat.jpg",
        "https://example.com/cat",
      ],
    ]);
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));

    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest("/search/images?q=cats&token=abc"),
      response,
      vi.fn(),
    );

    const [body] = response.end.mock.calls[0];
    expect(JSON.parse(body)).toEqual([]);
  });

  it("responds 500 when an unexpected error is thrown", async () => {
    vi.mocked(fetchSearXNG).mockResolvedValue([
      ["Title", "Snippet", "https://example.com"],
    ]);
    vi.mocked(getRerankerStatus).mockRejectedValue(new Error("reranker down"));

    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest("/search/text?q=cats&token=abc"),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(500);
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Internal server error" }),
    );
  });
});
