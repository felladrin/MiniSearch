import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./fallbackSearchService", () => ({
  assertSearchFallbackConfiguration: vi.fn(),
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
  addOfficialLaneResults: vi.fn(),
  incrementOfficialLaneFailures: vi.fn(),
  incrementOfficialLaneSearches: vi.fn(),
  incrementTextualSearchesSinceLastRestart: vi.fn(),
  incrementGraphicalSearchesSinceLastRestart: vi.fn(),
  incrementSearchesServedByFallback: vi.fn(),
  incrementSearchesFailedOnFallback: vi.fn(),
  recordSearchDuration: vi.fn(),
}));

vi.mock("./webSearchService", () => ({
  fetchSearXNG: vi.fn(),
  fetchSupplementarySearXNG: vi.fn(),
}));

import {
  assertSearchFallbackConfiguration,
  fetchFallbackTextResults,
  isSearchFallbackEnabled,
} from "./fallbackSearchService";
import { handleTokenVerification } from "./handleTokenVerification";
import {
  createRequest,
  createResponse,
  expectBadHostRejected,
  getRegisteredHookHandler,
} from "./hookTestUtils";

import { rankSearchResults } from "./rankSearchResults";
import { getRerankerStatus } from "./rerankerService";
import { searchEndpointServerHook } from "./searchEndpointServerHook";
import {
  addOfficialLaneResults,
  incrementGraphicalSearchesSinceLastRestart,
  incrementOfficialLaneFailures,
  incrementOfficialLaneSearches,
  incrementSearchesFailedOnFallback,
  incrementSearchesServedByFallback,
  incrementTextualSearchesSinceLastRestart,
  recordSearchDuration,
} from "./searchesSinceLastRestart";
import { fetchSearXNG, fetchSupplementarySearXNG } from "./webSearchService";

function getRegisteredHandler() {
  return getRegisteredHookHandler(searchEndpointServerHook);
}

/**
 * Registers the hook and sends `url` through it; returns the response. The
 * `next` is a fresh mock the test does not look at.
 */
async function sendSearch(url: string) {
  const response = createResponse();
  await getRegisteredHandler()(createRequest(url), response, vi.fn());
  return response;
}

/** The outage answer: 502 with the unavailable body. */
function expectServiceUnavailable(
  response: Awaited<ReturnType<typeof sendSearch>>,
) {
  expect(response.statusCode).toBe(502);
  expect(response.end).toHaveBeenCalledWith(
    JSON.stringify({ error: "Search service unavailable" }),
  );
}

/** The body the endpoint sent, parsed back from JSON. */
function endBody(response: Awaited<ReturnType<typeof sendSearch>>) {
  const [body] = response.end.mock.calls[0];
  return JSON.parse(body);
}

/** Checks the outage was reported and nothing came from the fallback. */
function expectOutageReportedWithoutFallback(
  response: Awaited<ReturnType<typeof sendSearch>>,
) {
  expectServiceUnavailable(response);
  expect(incrementSearchesFailedOnFallback).toHaveBeenCalledTimes(1);
  expect(incrementSearchesServedByFallback).not.toHaveBeenCalled();
  expect(recordSearchDuration).not.toHaveBeenCalled();
}

/** Everything the hook logged through `console.error`, as one string. */
function loggedText() {
  return vi.mocked(console.error).mock.calls.flat().join(" ");
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

  it("checks the fallback configuration at registration only when the fallback is on", () => {
    getRegisteredHandler();
    expect(assertSearchFallbackConfiguration).not.toHaveBeenCalled();

    vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
    getRegisteredHandler();
    expect(assertSearchFallbackConfiguration).toHaveBeenCalledTimes(1);
  });

  it("refuses to register when the fallback configuration is invalid", () => {
    vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
    vi.mocked(assertSearchFallbackConfiguration).mockImplementationOnce(() => {
      throw new Error("SEARCH_FALLBACK_PROVIDERS lists no provider");
    });

    // Thrown out of the hook itself, so the server stops at start rather
    // than answering 502 during the next SearXNG outage.
    expect(() => getRegisteredHandler()).toThrow(
      "SEARCH_FALLBACK_PROVIDERS lists no provider",
    );
  });

  it("passes through requests that aren't under /search/", async () => {
    const handler = getRegisteredHandler();
    const next = vi.fn();

    await handler(createRequest("/status"), createResponse(), next);

    expect(next).toHaveBeenCalled();
    expect(fetchSearXNG).not.toHaveBeenCalled();
  });

  it.each([
    "/search/",
    "/search/foo",
    "/search/textual",
    "/search/text/",
    "/search/text/x",
    "/search/images2",
  ])("answers 404 to %s without running a search", async (path) => {
    const handler = getRegisteredHandler();
    const response = createResponse();
    const next = vi.fn();

    await handler(createRequest(`${path}?q=cats&token=abc`), response, next);

    expect(response.statusCode).toBe(404);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json",
    );
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Not found" }),
    );
    // Nothing was authorized or searched, so nothing is verified, ranked or
    // counted.
    expect(handleTokenVerification).not.toHaveBeenCalled();
    expect(fetchSearXNG).not.toHaveBeenCalled();
    expect(recordSearchDuration).not.toHaveBeenCalled();
    expect(incrementTextualSearchesSinceLastRestart).not.toHaveBeenCalled();
    expect(incrementGraphicalSearchesSinceLastRestart).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("takes the search type from the path alone", async () => {
    vi.mocked(fetchSearXNG).mockResolvedValue([]);
    const handler = getRegisteredHandler();
    const unknown = createResponse();

    await handler(
      createRequest("/search/foo?q=cats&token=abc&next=/search/text"),
      unknown,
      vi.fn(),
    );
    await handler(
      createRequest("/search/images?q=cats&token=abc&next=/search/text"),
      createResponse(),
      vi.fn(),
    );

    expect(unknown.statusCode).toBe(404);
    expect(fetchSearXNG).toHaveBeenCalledTimes(1);
    expect(fetchSearXNG).toHaveBeenCalledWith(
      "cats",
      "images",
      30,
      undefined,
      expect.any(AbortSignal),
      undefined,
      undefined,
    );
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
    const response = await sendSearch("/search/text?q=cats&token=abc");

    expect(fetchSearXNG).toHaveBeenCalledWith(
      "cats",
      "text",
      30,
      undefined,
      expect.any(AbortSignal),
      undefined,
      undefined,
    );
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

    expect(fetchSearXNG).toHaveBeenCalledWith(
      "cats",
      "text",
      30,
      undefined,
      expect.any(AbortSignal),
      undefined,
      undefined,
    );
  });

  describe("time_range parameter", () => {
    it.each(["day", "week", "month", "year"] as const)(
      "passes %s through to SearXNG",
      async (timeRange) => {
        vi.mocked(fetchSearXNG).mockResolvedValue([]);

        await sendSearch(
          `/search/text?q=cats&token=abc&time_range=${timeRange}`,
        );

        expect(fetchSearXNG).toHaveBeenCalledWith(
          "cats",
          "text",
          30,
          undefined,
          expect.any(AbortSignal),
          timeRange,
          undefined,
        );
      },
    );

    it("passes it on an image search as well", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([]);

      await sendSearch("/search/images?q=cats&token=abc&time_range=month");

      expect(fetchSearXNG).toHaveBeenCalledWith(
        "cats",
        "images",
        30,
        undefined,
        expect.any(AbortSignal),
        "month",
        undefined,
      );
    });

    it("passes nothing when the request carries no time range", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([]);

      await sendSearch("/search/text?q=cats&token=abc");

      expect(fetchSearXNG).toHaveBeenCalledWith(
        "cats",
        "text",
        30,
        undefined,
        expect.any(AbortSignal),
        undefined,
        undefined,
      );
    });

    it("answers 400 to a period SearXNG does not know", async () => {
      const response = await sendSearch(
        "/search/text?q=cats&token=abc&time_range=fortnight",
      );

      // Refused rather than answered unfiltered: results from any time would
      // look like the recent ones the caller asked for.
      expect(response.statusCode).toBe(400);
      expect(response.end).toHaveBeenCalledWith(
        JSON.stringify({ error: "Invalid time_range parameter" }),
      );
      expect(fetchSearXNG).not.toHaveBeenCalled();
    });

    it("answers 400 to an empty time range", async () => {
      const response = await sendSearch(
        "/search/text?q=cats&token=abc&time_range=",
      );

      expect(response.statusCode).toBe(400);
      expect(fetchSearXNG).not.toHaveBeenCalled();
    });
  });

  describe("language parameter", () => {
    it.each(["pt-BR", "en-US", "all", "auto"])(
      "passes %s through to SearXNG as its language",
      async (language) => {
        vi.mocked(fetchSearXNG).mockResolvedValue([]);

        await sendSearch(`/search/text?q=cats&token=abc&language=${language}`);

        expect(fetchSearXNG).toHaveBeenCalledWith(
          "cats",
          "text",
          30,
          undefined,
          expect.any(AbortSignal),
          undefined,
          language,
        );
      },
    );

    it("passes it on an image search as well", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([]);

      await sendSearch("/search/images?q=cats&token=abc&language=pt-BR");

      expect(fetchSearXNG).toHaveBeenCalledWith(
        "cats",
        "images",
        30,
        undefined,
        expect.any(AbortSignal),
        undefined,
        "pt-BR",
      );
    });

    it("passes it next to a time range when the search asked for both", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([]);

      await sendSearch(
        "/search/text?q=cats&token=abc&time_range=week&language=de",
      );

      expect(fetchSearXNG).toHaveBeenCalledWith(
        "cats",
        "text",
        30,
        undefined,
        expect.any(AbortSignal),
        "week",
        "de",
      );
    });

    it("passes nothing when the request carries no language", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([]);

      // An older client or a direct API call: SearXNG keeps its own default,
      // exactly as it did before the setting existed.
      await sendSearch("/search/text?q=cats&token=abc");

      const searchArgs = vi.mocked(fetchSearXNG).mock.calls[0];
      expect(searchArgs.slice(5)).toEqual([undefined, undefined]);
    });

    it.each(["Portugu%C3%AAs", "pt_BR", "pt-BR-brazil", "english", ""])(
      "answers 400 to a language SearXNG does not take",
      async (language) => {
        const response = await sendSearch(
          `/search/text?q=cats&token=abc&language=${language}`,
        );

        // Refused rather than answered in some other language: results in the
        // wrong one would pass as the ones the caller asked for.
        expect(response.statusCode).toBe(400);
        expect(response.end).toHaveBeenCalledWith(
          JSON.stringify({ error: "Invalid language parameter" }),
        );
        expect(fetchSearXNG).not.toHaveBeenCalled();
      },
    );
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

    const response = await sendSearch("/search/text?q=test&token=abc&limit=5");

    expect(fetchSearXNG).toHaveBeenCalledWith(
      "test",
      "text",
      5,
      undefined,
      expect.any(AbortSignal),
      undefined,
      undefined,
    );
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

    const response = await sendSearch("/search/images?q=cats&token=abc");

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

      const response = await sendSearch("/search/text?q=cats&token=abc");

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

      const response = await sendSearch("/search/text?q=cats&token=abc");

      expect(response.statusCode).toBe(200);
      expect(response.end).toHaveBeenCalledWith(JSON.stringify(searxngResults));
    });

    it("still serves image results when the reranker is down", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
      vi.mocked(getRerankerStatus).mockResolvedValue(false);

      const response = await sendSearch("/search/images?q=cats&token=abc");

      expect(rankSearchResults).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(200);
      expect(endBody(response)).toEqual([imageResult]);
    });

    it("still serves image results when reranking throws mid-request", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue([imageResult]);
      vi.mocked(getRerankerStatus).mockResolvedValue(true);
      vi.mocked(rankSearchResults).mockRejectedValue(
        new Error("Reranker model is not loaded"),
      );

      const response = await sendSearch("/search/images?q=cats&token=abc");

      expect(response.statusCode).toBe(200);
      expect(endBody(response)).toEqual([imageResult]);
    });

    it("keeps every reranked image from the same page", async () => {
      const galleryImages = ["first", "second"].map(
        (name) =>
          [
            `Gallery ${name}`,
            "https://example.com/gallery",
            `https://example.com/${name}-thumb.gif`,
            `https://example.com/${name}.gif`,
          ] as [string, string, string, string],
      );
      vi.mocked(fetchSearXNG).mockResolvedValue(galleryImages);
      vi.mocked(getRerankerStatus).mockResolvedValue(true);
      vi.mocked(rankSearchResults).mockResolvedValue([
        ["Gallery second", "", "https://example.com/gallery", 0.9],
        ["Gallery first", "", "https://example.com/gallery", 0.5],
      ]);

      const response = await sendSearch("/search/images?q=cats&token=abc");

      expect(response.statusCode).toBe(200);
      expect(endBody(response)).toEqual([galleryImages[1], galleryImages[0]]);
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

      const response = await sendSearch("/search/images?q=cats&token=abc");

      expect(response.statusCode).toBe(200);
      expect(response.end).toHaveBeenCalledWith("[]");
    });

    it("answers 502 when SearXNG is down", async () => {
      vi.mocked(fetchSearXNG).mockRejectedValue(
        new Error("SearXNG request failed with status 503"),
      );

      const response = await sendSearch("/search/text?q=cats&token=abc");

      expectServiceUnavailable(response);
    });

    it("answers 502 on image searches when SearXNG is down", async () => {
      vi.mocked(fetchSearXNG).mockRejectedValue(new Error("network down"));

      const response = await sendSearch("/search/images?q=cats&token=abc");

      expectServiceUnavailable(response);
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

      it("gives up on a stalled SearXNG in time for the fallback to answer", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        vi.mocked(fetchFallbackTextResults).mockResolvedValue(fallbackResults);
        const deadline = new AbortController();
        const timeoutSpy = vi
          .spyOn(AbortSignal, "timeout")
          .mockReturnValue(deadline.signal);
        // SearXNG never answers; only the deadline signal ends the request.
        vi.mocked(fetchSearXNG).mockImplementation(
          (_query, _searchType, _limit, _breaker, signal) =>
            new Promise((_resolve, reject) => {
              signal?.addEventListener("abort", () => reject(signal.reason));
            }),
        );
        const now = vi.spyOn(performance, "now").mockReturnValue(0);

        const handler = getRegisteredHandler();
        const response = createResponse();
        const handled = handler(
          createRequest("/search/text?q=cats&token=abc"),
          response,
          vi.fn(),
        );

        await vi.waitFor(() => expect(fetchSearXNG).toHaveBeenCalled());
        expect(timeoutSpy).toHaveBeenCalledWith(15_000);
        now.mockReturnValue(15_000);
        deadline.abort(new DOMException("timed out", "TimeoutError"));
        await handled;

        // The 10 s reserve is left for the fallback, which serves the search.
        expect(fetchFallbackTextResults).toHaveBeenCalledWith(
          "cats",
          30,
          10_000,
        );
        expect(response.statusCode).toBe(200);
        expect(incrementSearchesServedByFallback).toHaveBeenCalledTimes(1);
      });

      it("gives SearXNG the whole deadline when no fallback can follow", async () => {
        vi.mocked(fetchSearXNG).mockResolvedValue([]);
        const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

        const handler = getRegisteredHandler();
        await handler(
          createRequest("/search/text?q=cats&token=abc"),
          createResponse(),
          vi.fn(),
        );

        expect(timeoutSpy).toHaveBeenCalledWith(25_000);
      });

      it("serves the fallback results through the normal text path", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockResolvedValue(fallbackResults);
        vi.mocked(getRerankerStatus).mockResolvedValue(true);
        vi.mocked(rankSearchResults).mockResolvedValue(rankedFallbackResults);
        // A search that has just started hands the fallback the whole budget.
        vi.spyOn(performance, "now").mockReturnValue(0);

        const response = await sendSearch("/search/text?q=cats&token=abc");

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

      it("says the time filter was not applied when the fallback answers a filtered search", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockResolvedValue(fallbackResults);

        const response = await sendSearch(
          "/search/text?q=cats&token=abc&time_range=week",
        );

        expect(response.statusCode).toBe(200);
        expect(response.setHeader).toHaveBeenCalledWith(
          "X-Search-Time-Range-Applied",
          "false",
        );
        // The body keeps its shape: the note is the header's job alone.
        expect(response.end).toHaveBeenCalledWith(
          JSON.stringify(fallbackResults),
        );
      });

      it("says nothing when the fallback answers a search with no filter", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockResolvedValue(fallbackResults);

        const response = await sendSearch("/search/text?q=cats&token=abc");

        expect(response.statusCode).toBe(200);
        expect(response.setHeader).not.toHaveBeenCalledWith(
          "X-Search-Time-Range-Applied",
          "false",
        );
        expect(response.setHeader).not.toHaveBeenCalledWith(
          "X-Search-Language-Applied",
          "false",
        );
      });

      it("says the language was not applied when the fallback answers a search that asked for one", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockResolvedValue(fallbackResults);

        const response = await sendSearch(
          "/search/text?q=cats&token=abc&language=pt-BR",
        );

        expect(response.statusCode).toBe(200);
        expect(response.setHeader).toHaveBeenCalledWith(
          "X-Search-Language-Applied",
          "false",
        );
      });

      it("names both filters when the fallback answers a search that asked for both", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockResolvedValue(fallbackResults);

        const response = await sendSearch(
          "/search/text?q=cats&token=abc&time_range=week&language=pt-BR",
        );

        expect(response.statusCode).toBe(200);
        expect(response.setHeader).toHaveBeenCalledWith(
          "X-Search-Time-Range-Applied",
          "false",
        );
        expect(response.setHeader).toHaveBeenCalledWith(
          "X-Search-Language-Applied",
          "false",
        );
      });

      it("says nothing when SearXNG answers a filtered search itself", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);

        const response = await sendSearch(
          "/search/text?q=cats&token=abc&time_range=week",
        );

        expect(response.statusCode).toBe(200);
        expect(response.setHeader).not.toHaveBeenCalledWith(
          "X-Search-Time-Range-Applied",
          "false",
        );
      });

      it("answers 200 with an empty list when the fallback returns nothing usable", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockResolvedValue([]);

        const response = await sendSearch("/search/text?q=cats&token=abc");

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

        const response = await sendSearch("/search/text?q=cats&token=abc");

        // A fallback started now would answer after the client's own 30 s
        // timeout, so it is never asked and the outage is reported the way it
        // would have been with the feature off.
        expect(fetchFallbackTextResults).not.toHaveBeenCalled();
        expectOutageReportedWithoutFallback(response);

        expect(loggedText()).toContain(
          "the search deadline left the fallback too little time",
        );
        expect(loggedText()).not.toContain("cats");
      });

      it("hands the fallback the time left, not its own full budget", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();
        vi.mocked(fetchFallbackTextResults).mockResolvedValue([]);
        // 0 for the search's start, then 12 s in when SearXNG gives up.
        vi.spyOn(performance, "now")
          .mockReturnValueOnce(0)
          .mockReturnValue(12_000);

        const response = await sendSearch("/search/text?q=cats&token=abc");

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

        const response = await sendSearch("/search/text?q=cats&token=abc");

        expectOutageReportedWithoutFallback(response);

        expect(loggedText()).toContain(
          "The fallback search tool call failed with status 502",
        );
        expect(loggedText()).not.toContain("cats");
      });

      it("answers 502 without consulting the fallback when it is switched off", async () => {
        failSearxng();

        const response = await sendSearch("/search/text?q=cats&token=abc");

        expectServiceUnavailable(response);
        expect(fetchFallbackTextResults).not.toHaveBeenCalled();
        expect(incrementSearchesServedByFallback).not.toHaveBeenCalled();
        expect(incrementSearchesFailedOnFallback).not.toHaveBeenCalled();
      });

      it("never consults the fallback for an image search", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        failSearxng();

        const response = await sendSearch("/search/images?q=cats&token=abc");

        expectServiceUnavailable(response);
        expect(fetchFallbackTextResults).not.toHaveBeenCalled();
        expect(incrementSearchesServedByFallback).not.toHaveBeenCalled();
        expect(incrementSearchesFailedOnFallback).not.toHaveBeenCalled();
      });

      it("never consults the fallback when SearXNG answers", async () => {
        vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
        vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);

        const response = await sendSearch("/search/text?q=cats&token=abc");

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

    const response = await sendSearch("/search/text?q=cats&token=abc");

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

  describe("official lane", () => {
    const query = "/search/text?q=disney%20showtimes&token=abc";
    const searxngResults: [string, string, string][] = [
      ["Disney showtimes roundup", "Blog", "https://blog.example.com/disney"],
      ["Disney", "Official site", "https://www.disney.com/"],
    ];
    const laneResults: [string, string, string][] = [
      ["Showtimes", "Official schedule", "https://www.disney.com/showtimes"],
    ];

    beforeEach(() => {
      vi.stubEnv("SEARCH_OFFICIAL_LANE_ENABLED", "true");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it("never gives the lane the last five seconds of the search deadline", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);
      vi.mocked(fetchSupplementarySearXNG).mockResolvedValue([]);
      // SearXNG answered at 19 s of the 25 s deadline: 6 s remain, and the
      // lane may only spend what is left after the last 5.
      vi.spyOn(performance, "now")
        .mockReturnValueOnce(0)
        .mockReturnValue(19_000);
      const timeout = vi.spyOn(AbortSignal, "timeout");
      const handler = getRegisteredHandler();

      await handler(createRequest(query), createResponse(), vi.fn());

      expect(timeout).toHaveBeenCalledWith(1_000);
    });

    it("skips the lane when no more than five seconds remain", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);
      // SearXNG answered at 21 s: the 4 s left all belong to the ranking.
      vi.spyOn(performance, "now")
        .mockReturnValueOnce(0)
        .mockReturnValue(21_000);
      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(createRequest(query), response, vi.fn());

      expect(incrementOfficialLaneSearches).not.toHaveBeenCalled();
      expect(incrementOfficialLaneFailures).not.toHaveBeenCalled();
      expect(fetchSupplementarySearXNG).not.toHaveBeenCalled();
      expect(response.end).toHaveBeenCalledWith(JSON.stringify(searxngResults));
    });

    it("gives the supplementary search the same time range", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);
      vi.mocked(fetchSupplementarySearXNG).mockResolvedValue([]);
      const handler = getRegisteredHandler();

      await handler(
        createRequest(`${query}&time_range=day`),
        createResponse(),
        vi.fn(),
      );

      expect(fetchSupplementarySearXNG).toHaveBeenCalledWith(
        "site:disney.com disney showtimes",
        30,
        expect.any(AbortSignal),
        "day",
        undefined,
      );
    });

    it("gives the supplementary search the same language", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);
      vi.mocked(fetchSupplementarySearXNG).mockResolvedValue([]);
      const handler = getRegisteredHandler();

      await handler(
        createRequest(`${query}&language=pt-BR`),
        createResponse(),
        vi.fn(),
      );

      expect(fetchSupplementarySearXNG).toHaveBeenCalledWith(
        "site:disney.com disney showtimes",
        30,
        expect.any(AbortSignal),
        undefined,
        "pt-BR",
      );
    });

    it("asks a supplementary search for the named site and merges it behind the first result", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);
      vi.mocked(fetchSupplementarySearXNG).mockResolvedValue(laneResults);
      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(createRequest(query), response, vi.fn());

      // One request through the retrying, circuit-counted path: the lane's
      // own request must not slow down or count against the user's search.
      expect(fetchSearXNG).toHaveBeenCalledTimes(1);
      expect(fetchSupplementarySearXNG).toHaveBeenCalledWith(
        "site:disney.com disney showtimes",
        30,
        expect.any(AbortSignal),
        undefined,
        undefined,
      );
      expect(response.end).toHaveBeenCalledWith(
        JSON.stringify([searxngResults[0], laneResults[0], searxngResults[1]]),
      );
      expect(addOfficialLaneResults).toHaveBeenCalledWith(1);
    });

    it("skips the lane when the fallback served the search", async () => {
      vi.mocked(isSearchFallbackEnabled).mockReturnValue(true);
      vi.mocked(fetchSearXNG).mockRejectedValue(
        new Error("SearXNG request failed with status 503"),
      );
      vi.mocked(fetchFallbackTextResults).mockResolvedValue(searxngResults);
      const handler = getRegisteredHandler();
      const response = createResponse();

      await handler(createRequest(query), response, vi.fn());

      expect(fetchSearXNG).toHaveBeenCalledTimes(1);
      expect(fetchSupplementarySearXNG).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(200);
    });

    it("serves the search it already has when the lane fails", async () => {
      vi.mocked(fetchSearXNG).mockResolvedValue(searxngResults);
      vi.mocked(fetchSupplementarySearXNG).mockRejectedValue(
        new Error("This operation was aborted"),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const handler = getRegisteredHandler();
      const response = createResponse();

      try {
        await handler(createRequest(query), response, vi.fn());
      } finally {
        errorSpy.mockRestore();
      }

      expect(response.statusCode).toBe(200);
      expect(response.end).toHaveBeenCalledWith(JSON.stringify(searxngResults));
      expect(incrementOfficialLaneFailures).toHaveBeenCalledTimes(1);
    });
  });
});

describe("searchEndpointServerHook with a malformed Host header", () => {
  it("answers 400 and keeps the handler promise from rejecting", async () => {
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: true,
    });
    await expectBadHostRejected(
      getRegisteredHandler(),
      "/search/text?q=cats&token=abc",
      handleTokenVerification,
    );
  });
});
