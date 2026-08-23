import debug from "debug";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";
import {
  getSearchesWithAllResultsDiscardedSinceLastRestart,
  getSearchesWithoutResultsSinceLastRestart,
  getSearchesWithUnresponsiveEnginesSinceLastRestart,
} from "./searchesSinceLastRestart";
import { CircuitBreaker } from "./utils/circuitBreaker";
import {
  describeUnresponsiveEngines,
  fetchSearXNG,
  getWebSearchStatus,
} from "./webSearchService";

function createMockResponse(
  text: string,
  ok = true,
  status?: number,
): Response {
  const resolvedStatus = status ?? (ok ? 200 : 503);
  return {
    ok,
    status: resolvedStatus,
    statusText: ok ? "OK" : "Error",
    headers: new Headers(),
    redirected: false,
    type: "basic" as ResponseType,
    url: "http://test.com",
    clone: function () {
      return this;
    },
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    json: () => Promise.resolve(JSON.parse(text)),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

const successResponse = () =>
  createMockResponse(
    JSON.stringify({
      results: [
        {
          title: "example",
          url: "https://example.com",
          content: "example content",
          category: "general",
        },
      ],
    }),
  );

let originalFetch: typeof fetch;
let fetchMock: MockedFunction<typeof fetch>;

beforeEach(() => {
  originalFetch = global.fetch;
  fetchMock = vi.fn() as unknown as MockedFunction<typeof fetch>;
  global.fetch = fetchMock;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("WebSearchService", () => {
  it("should report service not available when fetch throws", async () => {
    (global.fetch as MockedFunction<typeof fetch>).mockImplementation(() => {
      throw new Error("Network error");
    });
    const status = await getWebSearchStatus();
    expect(status).toBe(false);
  });

  it("should return false when health endpoint does not return OK", async () => {
    (global.fetch as MockedFunction<typeof fetch>).mockResolvedValue(
      createMockResponse("NOT_OK", false),
    );
    const status = await getWebSearchStatus();
    expect(status).toBe(false);
  });

  it("should return true when health endpoint returns OK", async () => {
    (global.fetch as MockedFunction<typeof fetch>).mockResolvedValueOnce(
      createMockResponse("OK"),
    );

    const status = await getWebSearchStatus();
    expect(status).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns false when health endpoint hangs and the request times out", async () => {
    vi.useFakeTimers();
    try {
      (global.fetch as MockedFunction<typeof fetch>).mockImplementation(
        (_input: string | Request | URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("Aborted")),
            );
          }),
      );

      const promise = getWebSearchStatus();
      await vi.advanceTimersByTimeAsync(2000);
      const status = await promise;
      expect(status).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should throw when SearXNG is unreachable", async () => {
    (global.fetch as MockedFunction<typeof fetch>).mockRejectedValue(
      new Error("Network failure"),
    );
    await expect(fetchSearXNG("test query", "text")).rejects.toThrow(
      "Network failure",
    );
  });
});

describe("describeUnresponsiveEngines", () => {
  it("returns null when there are no unresponsive engines", () => {
    expect(describeUnresponsiveEngines(undefined)).toBeNull();
    expect(describeUnresponsiveEngines([])).toBeNull();
    expect(describeUnresponsiveEngines("not-an-array")).toBeNull();
  });

  it("formats engine/reason pairs from SearXNG", () => {
    expect(
      describeUnresponsiveEngines([
        ["google", "Timeout"],
        ["bing", "Suspended: Access denied"],
      ]),
    ).toBe("google (Timeout), bing (Suspended: Access denied)");
  });

  it("handles entries without a reason", () => {
    expect(describeUnresponsiveEngines([["duckduckgo"]])).toBe("duckduckgo");
  });

  it("falls back to string conversion for unexpected shapes", () => {
    expect(describeUnresponsiveEngines(["qwant"])).toBe("qwant");
  });
});

describe("retry logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on 500 and returns results on eventual success", async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse("", false, 500))
      .mockResolvedValueOnce(createMockResponse("", false, 500))
      .mockResolvedValueOnce(successResponse());

    const promise = fetchSearXNG("test", "text");
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(1);
  });

  it("throws when all retries return 500", async () => {
    fetchMock.mockResolvedValue(createMockResponse("", false, 500));

    const promise = fetchSearXNG("test", "text");
    const outcome = expect(promise).rejects.toThrow(
      "SearXNG request failed with status 500",
    );
    await vi.runAllTimersAsync();
    await outcome;

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries an empty response with unresponsive engines and returns results on eventual success", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createMockResponse(
          JSON.stringify({
            results: [],
            unresponsive_engines: [["google", "CAPTCHA"]],
          }),
        ),
      )
      .mockResolvedValueOnce(successResponse());

    const searchesWithUnresponsiveEngines =
      getSearchesWithUnresponsiveEnginesSinceLastRestart();
    const promise = fetchSearXNG("test", "text");
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
    // A search that recovers on a retry is a search, not a failure.
    expect(getSearchesWithUnresponsiveEnginesSinceLastRestart()).toBe(
      searchesWithUnresponsiveEngines,
    );
  });

  it("throws when the empty response with unresponsive engines persists across all retries", async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        JSON.stringify({
          results: [],
          unresponsive_engines: [["google", "Timeout"]],
        }),
      ),
    );
    const searchesWithUnresponsiveEngines =
      getSearchesWithUnresponsiveEnginesSinceLastRestart();

    const promise = fetchSearXNG("test", "text");
    const outcome = expect(promise).rejects.toThrow(
      "Unresponsive engines: google (Timeout)",
    );
    await vi.runAllTimersAsync();
    await outcome;

    // One user-visible failure, not one per attempt.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(getSearchesWithUnresponsiveEnginesSinceLastRestart()).toBe(
      searchesWithUnresponsiveEngines + 1,
    );
  });

  it("classifies a retry that comes back empty without engine errors as a search without results", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createMockResponse(
          JSON.stringify({
            results: [],
            unresponsive_engines: [["google", "Timeout"]],
          }),
        ),
      )
      .mockResolvedValueOnce(
        createMockResponse(JSON.stringify({ results: [] })),
      );

    const searchesWithoutResults = getSearchesWithoutResultsSinceLastRestart();
    const searchesWithUnresponsiveEngines =
      getSearchesWithUnresponsiveEnginesSinceLastRestart();
    const promise = fetchSearXNG("test", "text");
    await vi.runAllTimersAsync();
    const results = await promise;

    // The classification follows the response the search ends on, so a retry
    // that recovers to a clean zero is a no-results search, not a failure.
    expect(results).toEqual([]);
    expect(getSearchesWithoutResultsSinceLastRestart()).toBe(
      searchesWithoutResults + 1,
    );
    expect(getSearchesWithUnresponsiveEnginesSinceLastRestart()).toBe(
      searchesWithUnresponsiveEngines,
    );
  });
});

describe("graceful degradation", () => {
  // One initial attempt plus MAX_RETRIES.
  const ATTEMPTS_PER_CALL = 4;
  // BASE_RETRY_DELAY doubling across the three retries: 1000 + 2000 + 4000.
  const RETRY_BACKOFF_TOTAL_MS = 7000;

  const breakerOptions = {
    // Far enough out that the reset timer cannot fire while a test is still
    // driving retry cycles: the margin would otherwise depend on MAX_RETRIES.
    // The recovery test advances by `resetTimeout + 1` rather than a literal.
    failureThreshold: 5,
    resetTimeout: 600_000,
    successThreshold: 1,
  };

  /**
   * Advances only far enough to drain the retry backoff. `runAllTimersAsync`
   * would also fire the breaker's own reset timer, flipping an open circuit to
   * half-open and letting the next call reach SearXNG again.
   *
   * The rejection assertion is attached before the timers advance, so the
   * failure stays a handled rejection the whole way through.
   */
  async function searchThroughRetries(breaker: CircuitBreaker) {
    const promise = fetchSearXNG("failure injection", "text", 30, breaker);
    // Deliberately not pinned to a message: callers drive this through phases
    // that fail differently, an exhausted retry cycle and a refusal by the
    // open circuit, and the fetch counts are what carry each claim.
    const outcome = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_TOTAL_MS);
    await outcome;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a whole exhausted retry cycle as one breaker failure, and opens on the fifth", async () => {
    const breaker = new CircuitBreaker(breakerOptions);
    fetchMock.mockResolvedValue(createMockResponse("", false, 500));

    for (let cycle = 0; cycle < breakerOptions.failureThreshold - 1; cycle++) {
      await searchThroughRetries(breaker);
    }

    // Four full cycles of upstream requests, still one failure short of opening.
    expect(fetchMock).toHaveBeenCalledTimes(
      (breakerOptions.failureThreshold - 1) * ATTEMPTS_PER_CALL,
    );
    expect(breaker.getState("searxng")).toBe("CLOSED");

    await searchThroughRetries(breaker);

    expect(fetchMock).toHaveBeenCalledTimes(
      breakerOptions.failureThreshold * ATTEMPTS_PER_CALL,
    );
    expect(breaker.getState("searxng")).toBe("OPEN");

    // Open now, so the next call is refused without reaching SearXNG.
    const callsWhileOpen = fetchMock.mock.calls.length;
    await searchThroughRetries(breaker);

    expect(fetchMock).toHaveBeenCalledTimes(callsWhileOpen);
  });

  it("closes the circuit again once SearXNG recovers after the reset timeout", async () => {
    const breaker = new CircuitBreaker(breakerOptions);
    fetchMock.mockResolvedValue(createMockResponse("", false, 503));

    for (
      let failure = 0;
      failure < breakerOptions.failureThreshold;
      failure++
    ) {
      await expect(
        fetchSearXNG("failure injection", "text", 30, breaker),
      ).rejects.toThrow();
    }

    expect(breaker.getState("searxng")).toBe("OPEN");

    await vi.advanceTimersByTimeAsync(breakerOptions.resetTimeout + 1);
    fetchMock.mockResolvedValue(successResponse());

    const results = await fetchSearXNG(
      "failure injection",
      "text",
      30,
      breaker,
    );

    expect(results).toHaveLength(1);
    expect(breaker.getState("searxng")).toBe("CLOSED");
  });

  it("throws when the provider is down and returns an empty array for zero results", async () => {
    const downBreaker = new CircuitBreaker({ failureThreshold: 1 });
    fetchMock.mockResolvedValue(createMockResponse("", false, 503));

    await expect(
      fetchSearXNG("failure injection", "text", 30, downBreaker),
    ).rejects.toThrow();

    const emptyBreaker = new CircuitBreaker({ failureThreshold: 1 });
    fetchMock.mockResolvedValue(
      createMockResponse(JSON.stringify({ results: [] })),
    );
    const noResults = await fetchSearXNG(
      "failure injection",
      "text",
      30,
      emptyBreaker,
    );

    // The breaker still records which one was a failure, and now the caller
    // can tell them apart from the outcome as well.
    expect(downBreaker.getState("searxng")).toBe("OPEN");
    expect(emptyBreaker.getState("searxng")).toBe("CLOSED");
    expect(noResults).toEqual([]);
  });

  it("treats an empty response naming unresponsive engines as a failure", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    fetchMock.mockResolvedValue(
      createMockResponse(
        JSON.stringify({
          results: [],
          unresponsive_engines: [["google", "CAPTCHA"]],
        }),
      ),
    );
    const searchesWithoutResults = getSearchesWithoutResultsSinceLastRestart();
    const searchesWithUnresponsiveEngines =
      getSearchesWithUnresponsiveEnginesSinceLastRestart();

    const search = fetchSearXNG("failure injection", "text", 30, breaker);
    const outcome = expect(search).rejects.toThrow("google (CAPTCHA)");
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_TOTAL_MS);
    await outcome;

    expect(breaker.getState("searxng")).toBe("OPEN");
    // Some of the reported cases (timeouts, rate-limit windows) clear inside
    // the backoff, so the case gets the full retry budget before the search
    // fails, and the counter lands when the attempts run out.
    expect(fetchMock).toHaveBeenCalledTimes(ATTEMPTS_PER_CALL);
    expect(getSearchesWithoutResultsSinceLastRestart()).toBe(
      searchesWithoutResults,
    );
    expect(getSearchesWithUnresponsiveEnginesSinceLastRestart()).toBe(
      searchesWithUnresponsiveEngines + 1,
    );
  });

  it("throws when SearXNG answers 200 with a malformed body", async () => {
    fetchMock.mockResolvedValue(createMockResponse("<html>gateway</html>"));

    await expect(
      fetchSearXNG(
        "failure injection",
        "text",
        30,
        new CircuitBreaker(breakerOptions),
      ),
    ).rejects.toThrow();
  });

  it("returns an empty array when every result is dropped during processing", async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        JSON.stringify({
          results: [
            { title: "No snippet", url: "https://example.com" },
            { title: "", content: "orphan snippet", url: "https://other.com" },
          ],
        }),
      ),
    );

    const results = await fetchSearXNG(
      "failure injection",
      "text",
      30,
      new CircuitBreaker(breakerOptions),
    );

    expect(results).toEqual([]);
  });
});

describe("query privacy", () => {
  // The space is here on purpose: a leaked search URL carries it encoded (as
  // `+`, from URLSearchParams), which a match on the raw string alone misses.
  const DISTINCTIVE_QUERY = "borogoves outgrabe mimsy-42";

  let logLines: string[];
  let originalLog: typeof debug.log;

  /**
   * `debug` resolves its writer at call time, so replacing it here captures
   * everything the module logs through `debug`, which under jsdom never reaches
   * `console` in a spy-able way. The console spies cover the calls the module
   * makes directly, so a new logging line is caught whichever it uses.
   */
  beforeEach(() => {
    // The unresponsive-engine path retries, so the backoff timers must be
    // fake or those calls wait seven seconds of real time each.
    vi.useFakeTimers();
    logLines = [];
    originalLog = debug.log;
    debug.log = (...args: unknown[]) => {
      logLines.push(args.map(String).join(" "));
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map(String).join(" "));
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    debug.log = originalLog;
    vi.restoreAllMocks();
  });

  function emptyResponse() {
    return createMockResponse(
      JSON.stringify({
        results: [],
        unresponsive_engines: [["google", "Timeout"]],
      }),
    );
  }

  function unusableResultsResponse() {
    return createMockResponse(
      JSON.stringify({
        results: [{ title: "No snippet", url: "https://example.com" }],
      }),
    );
  }

  function imageResultsResponse() {
    return createMockResponse(
      JSON.stringify({
        results: [
          {
            title: "picture",
            url: "https://example.com/picture",
            category: "images",
            img_src: "https://example.com/picture.jpg",
            thumbnail_src: "https://example.com/thumbnail.jpg",
          },
        ],
      }),
    );
  }

  it("never writes the query to the log", async () => {
    fetchMock.mockResolvedValue(unusableResultsResponse());
    await fetchSearXNG(DISTINCTIVE_QUERY, "text", 30, new CircuitBreaker());

    // The unresponsive engines, the malformed body and the network failure all
    // make fetchSearXNG throw; the point here is that no path ever logs the
    // query.
    fetchMock.mockResolvedValue(emptyResponse());
    const unresponsiveSearch = fetchSearXNG(
      DISTINCTIVE_QUERY,
      "text",
      30,
      new CircuitBreaker(),
    );
    const unresponsiveOutcome = expect(unresponsiveSearch).rejects.toThrow(
      "Unresponsive engines",
    );
    await vi.runAllTimersAsync();
    await unresponsiveOutcome;

    fetchMock.mockResolvedValue(createMockResponse("<html>gateway</html>"));
    await expect(
      fetchSearXNG(DISTINCTIVE_QUERY, "text", 30, new CircuitBreaker()),
    ).rejects.toThrow();

    fetchMock.mockResolvedValue(imageResultsResponse());
    await fetchSearXNG(DISTINCTIVE_QUERY, "images", 30, new CircuitBreaker());

    fetchMock.mockRejectedValue(new Error("Network failure"));
    await expect(
      fetchSearXNG(DISTINCTIVE_QUERY, "images", 30, new CircuitBreaker()),
    ).rejects.toThrow();

    const output = logLines.join("\n");
    expect(logLines.length).toBeGreaterThan(0);

    for (const form of [
      DISTINCTIVE_QUERY,
      encodeURIComponent(DISTINCTIVE_QUERY),
      DISTINCTIVE_QUERY.replaceAll(" ", "+"),
    ]) {
      expect(output).not.toContain(form);
    }
  });

  it("still names the unresponsive engines behind a failed empty response", async () => {
    fetchMock.mockResolvedValue(emptyResponse());

    const search = fetchSearXNG(
      DISTINCTIVE_QUERY,
      "text",
      30,
      new CircuitBreaker(),
    );
    const outcome = expect(search).rejects.toThrow();
    await vi.runAllTimersAsync();
    await outcome;

    expect(logLines.join("\n")).toContain(
      "Unresponsive engines: google (Timeout)",
    );
    // The retry line carries the cause, so a recovered retry stays readable
    // in the log: engine names, never the query.
    expect(logLines.join("\n")).toContain(
      "returned no results (google (Timeout))",
    );
  });

  it("counts an empty response with no engine errors as a search without results", async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(JSON.stringify({ results: [] })),
    );
    const searchesWithoutResults = getSearchesWithoutResultsSinceLastRestart();

    const results = await fetchSearXNG(
      DISTINCTIVE_QUERY,
      "text",
      30,
      new CircuitBreaker(),
    );

    expect(results).toEqual([]);
    expect(logLines.join("\n")).toContain("No engine errors were reported");
    expect(getSearchesWithoutResultsSinceLastRestart()).toBe(
      searchesWithoutResults + 1,
    );
  });

  it("still reports the count and search type of a discarded batch", async () => {
    fetchMock.mockResolvedValue(unusableResultsResponse());
    const before = getSearchesWithAllResultsDiscardedSinceLastRestart();

    await fetchSearXNG(DISTINCTIVE_QUERY, "text", 30, new CircuitBreaker());

    expect(logLines.join("\n")).toContain(
      "All 1 text result(s) processed from the SearXNG response were discarded",
    );
    expect(getSearchesWithAllResultsDiscardedSinceLastRestart()).toBe(
      before + 1,
    );
  });
});

describe("circuit breaker", () => {
  // The retriable path is covered above, one breaker failure per exhausted
  // retry cycle. A non-retriable status throws on the first attempt, so this
  // holds both sides of the threshold for that path.
  it("opens on the fifth non-retriable failure, not before", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    fetchMock.mockResolvedValue(createMockResponse("", false, 503));

    for (let failure = 0; failure < 4; failure++) {
      await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow();
    }
    expect(breaker.getState("searxng")).toBe("CLOSED");

    const callsAfterFour = fetchMock.mock.calls.length;
    await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow();

    expect(fetchMock.mock.calls.length).toBe(callsAfterFour + 1);
    expect(breaker.getState("searxng")).toBe("OPEN");

    // Open now, so the next call is refused without reaching SearXNG.
    const callsWhileOpen = fetchMock.mock.calls.length;
    await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow();

    expect(fetchMock.mock.calls.length).toBe(callsWhileOpen);
  });
});
