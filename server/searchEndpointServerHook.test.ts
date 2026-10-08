import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./fallbackSearchService", () => ({
  fetchFallbackTextResults: vi.fn(),
  isSearchFallbackEnabled: vi.fn(),
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
  incrementSearchesServedByFallback: vi.fn(),
  incrementSearchesFailedOnFallback: vi.fn(),
  recordSearchDuration: vi.fn(),
}));

vi.mock("./webSearchService", () => ({
  fetchSearXNG: vi.fn(),
}));

import {
  fetchFallbackTextResults,
  isSearchFallbackEnabled,
} from "./fallbackSearchService";
import { handleTokenVerification } from "./handleTokenVerification";
import { rankSearchResults } from "./rankSearchResults";
import { getRerankerStatus } from "./rerankerService";
import { searchEndpointServerHook } from "./searchEndpointServerHook";
import {
  incrementGraphicalSearchesSinceLastRestart,
  incrementSearchesFailedOnFallback,
  incrementSearchesServedByFallback,
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
    vi.mocked(rankSearchResults).mockImplementation(
      async (_query, _searchType, results) =>
        results.map(([title, content, url]) => [title, content, url, 0]),
    );
    // Off unless a test switches it on, and answered with something rather
    // than undefined so an unexpected call fails a visible assertion instead
    // of poisoning the results below.
    vi.mocked(isSearchFallbackEnabled).mockReturnValue(false);
    vi.mocked(fetchFallbackTextResults).mockResolvedValue([]);
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
      "text",
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

    describe("text search fallback", () => {
      const fallbackResults: [string, string, string][] = [
        ["Fallback title", "Fallback snippet", "https://example.com/fallback"],
      ];
      const rankedFallbackResults: [string, string, string, number][] = [
        [
          "Fallback title",
          "Fallback snippet",
          "https://example.com/fallback",
          0.7,
        ],
      ];

      function failSearxng() {
        vi.mocked(fetchSearXNG).mockRejectedValue(
          new Error("SearXNG request failed with status 503"),
        );
      }

      it("serves the fallback results through the normal text path", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockResolvedValue(fallbackResults);
        vi.mocked(getRerankerStatus).mockResolvedValue(true);
        vi.mocked(rankSearchResults).mockResolvedValue(rankedFallbackResults);
        // A search that has just started hands the fallback the whole budget.
        vi.spyOn(performance, "now").mockReturnValue(0);

        const handler = getRegisteredHandler();
        const response = createResponse();

        await handler(
          createRequest("/search/text?q=cats&token=abc"),
          response,
          vi.fn(),
        );

        expect(fetchFallbackTextResults).toHaveBeenCalledWith(
          "cats",
          30,
          25_000,
        );
        // Reranked exactly like SearXNG results, with the top ones preserved,
        // and then answered by the one respond block the text path has.
        expect(rankSearchResults).toHaveBeenCalledWith(
          "cats",
          "text",
          fallbackResults,
          true,
        );
        expect(incrementTextualSearchesSinceLastRestart).toHaveBeenCalledTimes(
          1,
        );
        expect(incrementSearchesServedByFallback).toHaveBeenCalledTimes(1);
        expect(incrementSearchesFailedOnFallback).not.toHaveBeenCalled();
        // The duration metric is SearXNG's; the fallback's own latency is a
        // different thing and would be misleading under the same average.
        expect(recordSearchDuration).not.toHaveBeenCalled();
        expect(response.statusCode).toBe(200);
        expect(response.end).toHaveBeenCalledWith(
          JSON.stringify(rankedFallbackResults),
        );
      });

      it("answers 200 with an empty list when the fallback returns nothing usable", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockResolvedValue([]);

        const handler = getRegisteredHandler();
        const response = createResponse();

        await handler(
          createRequest("/search/text?q=cats&token=abc"),
          response,
          vi.fn(),
        );

        // The endpoint answered, so this is a search with no results rather
        // than an outage: the client shows the no-results alert, not the
        // unavailable one, and the fallback still counts as served.
        expect(response.statusCode).toBe(200);
        expect(response.end).toHaveBeenCalledWith(JSON.stringify([]));
        expect(incrementSearchesServedByFallback).toHaveBeenCalledTimes(1);
        expect(incrementSearchesFailedOnFallback).not.toHaveBeenCalled();
        expect(recordSearchDuration).not.toHaveBeenCalled();
      });

      it("skips the fallback when the search deadline has already passed", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        // 0 for the search's start, then past the 25 s deadline.
        vi.spyOn(performance, "now")
          .mockReturnValueOnce(0)
          .mockReturnValue(25_001);

        const handler = getRegisteredHandler();
        const response = createResponse();

        await handler(
          createRequest("/search/text?q=cats&token=abc"),
          response,
          vi.fn(),
        );

        // A fallback started now would answer after the client's own 30 s
        // timeout, so it is never asked and the outage is reported the way it
        // would have been with the feature off.
        expect(fetchFallbackTextResults).not.toHaveBeenCalled();
        expect(response.statusCode).toBe(502);
        expect(response.end).toHaveBeenCalledWith(
          JSON.stringify({ error: "Search service unavailable" }),
        );
        expect(incrementSearchesFailedOnFallback).toHaveBeenCalledTimes(1);
        expect(incrementSearchesServedByFallback).not.toHaveBeenCalled();
        expect(recordSearchDuration).not.toHaveBeenCalled();

        const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
        expect(logged).toContain(
          "the search deadline left the fallback too little time",
        );
        expect(logged).not.toContain("cats");
      });

      it("hands the fallback the time left, not its own full budget", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockResolvedValue([]);
        // 0 for the search's start, then 12 s in when SearXNG gives up.
        vi.spyOn(performance, "now")
          .mockReturnValueOnce(0)
          .mockReturnValue(12_000);

        const handler = getRegisteredHandler();
        const response = createResponse();

        await handler(
          createRequest("/search/text?q=cats&token=abc"),
          response,
          vi.fn(),
        );

        // 13 s are left of the 25 s deadline, which is under the fallback's
        // own 15 s cap, so the search cannot outlive the client's patience.
        expect(fetchFallbackTextResults).toHaveBeenCalledWith(
          "cats",
          30,
          13_000,
        );
        expect(response.statusCode).toBe(200);
      });

      it("answers 502 when the fallback fails too", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockRejectedValue(
          new Error("The fallback search tool call failed with status 502"),
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
        expect(incrementSearchesFailedOnFallback).toHaveBeenCalledTimes(1);
        expect(incrementSearchesServedByFallback).not.toHaveBeenCalled();
        expect(recordSearchDuration).not.toHaveBeenCalled();

        const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
        expect(logged).toContain(
          "The fallback search tool call failed with status 502",
        );
        expect(logged).not.toContain("cats");
      });

      it("answers 502 without consulting the fallback when it is switched off", async () => {
        failSearxng();

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
        expect(fetchFallbackTextResults).not.toHaveBeenCalled();
        expect(incrementSearchesServedByFallback).not.toHaveBeenCalled();
        expect(incrementSearchesFailedOnFallback).not.toHaveBeenCalled();
      });

      it("never consults the fallback for an image search", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();

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
        expect(fetchFallbackTextResults).not.toHaveBeenCalled();
        expect(incrementSearchesServedByFallback).not.toHaveBeenCalled();
        expect(incrementSearchesFailedOnFallback).not.toHaveBeenCalled();
      });

      it("never consults the fallback when SearXNG answers", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);

        const handler = getRegisteredHandler();
        const response = createResponse();

        await handler(
          createRequest("/search/text?q=cats&token=abc"),
          response,
          vi.fn(),
        );

        expect(response.statusCode).toBe(200);
        expect(response.end).toHaveBeenCalledWith(
          JSON.stringify(searxngResults),
        );
        expect(fetchFallbackTextResults).not.toHaveBeenCalled();
        expect(incrementSearchesServedByFallback).not.toHaveBeenCalled();
        expect(incrementSearchesFailedOnFallback).not.toHaveBeenCalled();
      });
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
