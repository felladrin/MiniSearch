import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));

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
    // clearAllMocks keeps implementations, and one degradation case installs a
    // fetch that only settles on abort.
    mockFetch.mockReset();
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
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

  it("verifies the token before reading the query parameters", async () => {
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: false,
    });
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(createRequest("/search/text"), response, vi.fn());

    // The malformed-query 400 would otherwise answer first, and a caller could
    // loop it without a token and without spending a rate-limit point.
    expect(handleTokenVerification).toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
    expect(fetchSearXNG).not.toHaveBeenCalled();
  });

  it("responds 400 when the query parameter exceeds the maximum length", async () => {
    const handler = getRegisteredHandler();
    const response = createResponse();
    const query = "a".repeat(2001);

    await handler(
      createRequest(`/search/text?q=${query}&token=abc`),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(400);
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify({
        error: "Query parameter must not exceed 2000 characters",
      }),
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

  it("clamps the requested result limit to the server maximum", async () => {
    vi.mocked(fetchSearXNG).mockResolvedValue([]);
    const handler = getRegisteredHandler();

    await handler(
      createRequest("/search/text?q=cats&token=abc&limit=1000"),
      createResponse(),
      vi.fn(),
    );

    expect(fetchSearXNG).toHaveBeenCalledWith("cats", "text", 30);
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

  describe("graceful degradation", () => {
    const searxngResults: [string, string, string][] = [
      ["A", "snippet a", "https://a.com"],
      ["B", "snippet b", "https://b.com"],
    ];
    const imageResult: [string, string, string, string] = [
      "Cat picture",
      "https://example.com/cat.jpg",
      "https://thumb.example.com/cat.jpg",
      "https://example.com/cat",
    ];
    const thumbnailDataUrl = `data:image/jpeg;base64,${Buffer.from([1, 2, 3]).toString("base64")}`;

    function respondWithThumbnail() {
      mockFetch.mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    }

    beforeEach(() => {
      // The degradation paths log on purpose; keep the test output readable.
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns unranked results when the reranker is down", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);
      vi.mocked(getRerankerStatus).mockResolvedValue(false);

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/text?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(rankSearchResults).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(200);
      expect(response.end).toHaveBeenCalledWith(JSON.stringify(searxngResults));
    });

    it("returns unranked results when reranking throws mid-request", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);
      vi.mocked(getRerankerStatus).mockResolvedValue(true);
      vi.mocked(rankSearchResults).mockRejectedValue(
        new Error("Reranker model is not loaded"),
      );

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/text?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(response.statusCode).toBe(200);
      expect(response.end).toHaveBeenCalledWith(JSON.stringify(searxngResults));
    });

    it("still serves image results when the reranker is down", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
      vi.mocked(getRerankerStatus).mockResolvedValue(false);
      respondWithThumbnail();

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/images?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(rankSearchResults).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(200);
      const [body] = response.end.mock.calls[0];
      expect(JSON.parse(body)).toEqual([
        [imageResult[0], imageResult[1], thumbnailDataUrl, imageResult[3]],
      ]);
    });

    it("still serves image results when reranking throws mid-request", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
      vi.mocked(getRerankerStatus).mockResolvedValue(true);
      vi.mocked(rankSearchResults).mockRejectedValue(
        new Error("Reranker model is not loaded"),
      );
      respondWithThumbnail();

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/images?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(response.statusCode).toBe(200);
      const [body] = response.end.mock.calls[0];
      expect(JSON.parse(body)).toEqual([
        [imageResult[0], imageResult[1], thumbnailDataUrl, imageResult[3]],
      ]);
    });

    it("drops an image the reranker returns under an unknown URL", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
      vi.mocked(getRerankerStatus).mockResolvedValue(true);
      vi.mocked(rankSearchResults).mockResolvedValue([
        ["Cat picture", "", "https://example.com/not-in-the-result-set.jpg"],
      ]);

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/images?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(response.statusCode).toBe(200);
      expect(response.end).toHaveBeenCalledWith("[]");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("drops an image whose thumbnail host never answers", async () => {
      // Matches THUMBNAIL_TIMEOUT_MS in searchEndpointServerHook.ts.
      const thumbnailTimeoutMs = 1000;
      vi.useFakeTimers();
      try {
        vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
        vi.mocked(getRerankerStatus).mockResolvedValue(false);
        mockFetch.mockImplementation(
          (_url: string, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new Error("The operation was aborted")),
              );
            }),
        );

        const handler = getRegisteredHandler();
        const response = createResponse();
        const handled = handler(
          createRequest("/search/images?q=cats&token=abc"),
          response,
          vi.fn(),
        );
        await vi.advanceTimersByTimeAsync(thumbnailTimeoutMs);
        await handled;

        expect(response.statusCode).toBe(200);
        expect(response.end).toHaveBeenCalledWith("[]");
      } finally {
        vi.useRealTimers();
      }
    });

    it("answers 502 when SearXNG is down", async () => {
      vi.mocked(fetchSearXNG).mockRejectedValue(
        new Error("SearXNG request failed with status 503"),
      );

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/text?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(response.statusCode).toBe(502);
      expect(response.end).toHaveBeenCalledWith(
        JSON.stringify({ error: "Search service unavailable" }),
      );
    });

    it("answers 502 on image searches when SearXNG is down", async () => {
      vi.mocked(fetchSearXNG).mockRejectedValue(new Error("network down"));

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/images?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(response.statusCode).toBe(502);
      expect(response.end).toHaveBeenCalledWith(
        JSON.stringify({ error: "Search service unavailable" }),
      );
    });

    it("drops an image whose thumbnail resolves to a private address", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
      vi.mocked(getRerankerStatus).mockResolvedValue(false);
      lookupMock.mockResolvedValue([{ address: "192.168.1.5", family: 4 }]);

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/images?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(response.statusCode).toBe(200);
      expect(response.end).toHaveBeenCalledWith("[]");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("drops an image whose thumbnail URL uses a non-HTTP scheme", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([
        [
          "Cat picture",
          "https://example.com/cat.jpg",
          "file:///etc/passwd",
          "https://example.com/cat",
        ],
      ]);
      vi.mocked(getRerankerStatus).mockResolvedValue(false);

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/images?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(response.statusCode).toBe(200);
      expect(response.end).toHaveBeenCalledWith("[]");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not follow a thumbnail redirect into a private address", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
      vi.mocked(getRerankerStatus).mockResolvedValue(false);
      lookupMock
        .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
        .mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);
      mockFetch.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://10.0.0.7/thumb.jpg" },
        }),
      );

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/images?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(response.statusCode).toBe(200);
      expect(response.end).toHaveBeenCalledWith("[]");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("truncates an oversized thumbnail body", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
      vi.mocked(getRerankerStatus).mockResolvedValue(false);
      const bigBody = new Uint8Array(600_000).fill(7);
      mockFetch.mockResolvedValue(
        new Response(bigBody, {
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

      const [body] = response.end.mock.calls[0];
      const [thumbnailDataUrl] = JSON.parse(body);
      expect(thumbnailDataUrl[2]).toContain("data:image/jpeg;base64,");
      // The cap is 500_000 bytes; a 600_000-byte body must be truncated.
      const decoded = Buffer.from(thumbnailDataUrl[2].split(",")[1], "base64");
      expect(decoded.length).toBe(500_000);
    });
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
