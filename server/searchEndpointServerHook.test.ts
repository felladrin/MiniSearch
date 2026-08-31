import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  recordSearchDuration: vi.fn(),
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
  recordSearchDuration,
} from "./searchesSinceLastRestart";
import { fetchSearXNG } from "./webSearchService";

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
    vi.mocked(rankSearchResults).mockImplementation(async (_query, results) =>
      results.map(([title, content, url]) => [title, content, url, 0]),
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
      ["B", "snippet b", "https://b.com", 0.9],
      ["A", "snippet a", "https://a.com", 0.5],
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
        ["B", "snippet b", "https://b.com", 0.9],
        ["A", "snippet a", "https://a.com", 0.5],
      ]),
    );
  });

  it("returns image results with the thumbnail URL untouched and increments the graphical counter", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("the search endpoint must not fetch thumbnails");
    });
    vi.mocked(fetchSearXNG).mockResolvedValue([
      [
        "Cat picture",
        "https://example.com/cat.jpg",
        "https://thumb.example.com/cat.jpg",
        "https://example.com/cat",
      ],
    ]);

    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest("/search/images?q=cats&token=abc"),
      response,
      vi.fn(),
    );

    expect(incrementGraphicalSearchesSinceLastRestart).toHaveBeenCalled();
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify([
        [
          "Cat picture",
          "https://example.com/cat.jpg",
          "https://thumb.example.com/cat.jpg",
          "https://example.com/cat",
        ],
      ]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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
      expect(JSON.parse(body)).toEqual([imageResult]);
    });

    it("still serves image results when reranking throws mid-request", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
      vi.mocked(getRerankerStatus).mockResolvedValue(true);
      vi.mocked(rankSearchResults).mockRejectedValue(
        new Error("Reranker model is not loaded"),
      );

      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(
        createRequest("/search/images?q=cats&token=abc"),
        response,
        vi.fn(),
      );

      expect(response.statusCode).toBe(200);
      const [body] = response.end.mock.calls[0];
      expect(JSON.parse(body)).toEqual([imageResult]);
    });

    it("drops an image the reranker returns under an unknown URL", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
      vi.mocked(getRerankerStatus).mockResolvedValue(true);
      vi.mocked(rankSearchResults).mockResolvedValue([
        [
          "Cat picture",
          "",
          "https://example.com/not-in-the-result-set.jpg",
          0.5,
        ],
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

  describe("search path counters", () => {
    it("records how long SearXNG took on a text search", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([
        ["Title", "Snippet", "https://example.com"],
      ]);
      const handler = getRegisteredHandler();

      await handler(
        createRequest("/search/text?q=test&token=abc"),
        createResponse(),
        vi.fn(),
      );

      expect(recordSearchDuration).toHaveBeenCalledWith(
        "text",
        expect.any(Number),
      );
    });

    it("does not record a duration when SearXNG fails", async () => {
      vi.mocked(fetchSearXNG).mockRejectedValue(new Error("down"));
      const handler = getRegisteredHandler();

      await handler(
        createRequest("/search/text?q=test&token=abc"),
        createResponse(),
        vi.fn(),
      );

      expect(recordSearchDuration).not.toHaveBeenCalled();
    });

    it("counts the searches served without the reranker", async () => {
      const { getRerankingStats } = await import("./rerankingSinceLastRestart");
      const before = getRerankingStats();
      vi.mocked(getRerankerStatus).mockResolvedValue(false);
      vi.mocked(fetchSearXNG).mockResolvedValue([
        ["Title", "Snippet", "https://example.com"],
      ]);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const handler = getRegisteredHandler();

      try {
        await handler(
          createRequest("/search/text?q=test&token=abc"),
          createResponse(),
          vi.fn(),
        );
      } finally {
        warnSpy.mockRestore();
      }

      expect(getRerankingStats().skippedUnhealthy).toBe(
        before.skippedUnhealthy + 1,
      );
    });

    it("counts a rerank that threw mid-request", async () => {
      const { getRerankingStats } = await import("./rerankingSinceLastRestart");
      const before = getRerankingStats();
      vi.mocked(getRerankerStatus).mockResolvedValue(true);
      vi.mocked(rankSearchResults).mockRejectedValue(new Error("model gone"));
      vi.mocked(fetchSearXNG).mockResolvedValue([
        ["Title", "Snippet", "https://example.com"],
      ]);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const handler = getRegisteredHandler();

      try {
        await handler(
          createRequest("/search/text?q=test&token=abc"),
          createResponse(),
          vi.fn(),
        );
      } finally {
        errorSpy.mockRestore();
      }

      expect(getRerankingStats().failed).toBe(before.failed + 1);
    });
  });
});
