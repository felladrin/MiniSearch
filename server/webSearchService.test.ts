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
  getDegradedSearchTypes,
  getSearchesWithAllResultsDiscardedSinceLastRestart,
  getSearchesWithoutResultsSinceLastRestart,
  getSearchesWithUnresponsiveEnginesSinceLastRestart,
  getUnresponsiveEngineStats,
} from "./searchesSinceLastRestart";
import { CircuitBreaker } from "./utils/circuitBreaker";
import {
  fetchSearXNG,
  formatUnresponsiveEngines,
  getWebSearchServiceStatus,
  getWebSearchStatus,
  parseUnresponsiveEngines,
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

const describeUnresponsiveEngines = (value: unknown) =>
  formatUnresponsiveEngines(parseUnresponsiveEngines(value));

describe("unresponsive engine reporting", () => {
  it("reads nothing from an absent or malformed field", () => {
    expect(parseUnresponsiveEngines(undefined)).toEqual([]);
    expect(parseUnresponsiveEngines([])).toEqual([]);
    expect(parseUnresponsiveEngines("not-an-array")).toEqual([]);
  });

  it("reads engine/reason pairs from SearXNG", () => {
    expect(
      parseUnresponsiveEngines([
        ["google", "Timeout"],
        ["bing", "Suspended: Access denied"],
      ]),
    ).toEqual([
      { engine: "google", reason: "Timeout" },
      { engine: "bing", reason: "Suspended: Access denied" },
    ]);
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

  it("retries an empty response with a transiently unresponsive engine and returns results on eventual success", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createMockResponse(
          JSON.stringify({
            results: [],
            // A timeout is transient: it can clear inside the backoff, so the
            // search keeps the retry budget (unlike a suspension, which fails
            // fast). See the fail-fast test below for the suspended case.
            unresponsive_engines: [["google", "Timeout"]],
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

  it("keeps the retry budget when the unresponsive engine reports a non-suspending error", async () => {
    // "server API error" is not a suspension in SearXNG's exception
    // vocabulary, so the search must not fail fast and has to spend the
    // backoff like any transient failure.
    fetchMock.mockResolvedValue(
      createMockResponse(
        JSON.stringify({
          results: [],
          unresponsive_engines: [["google", "server API error"]],
        }),
      ),
    );

    const promise = fetchSearXNG("test", "text");
    const outcome = expect(promise).rejects.toThrow(
      "Unresponsive engines: google (server API error)",
    );
    await vi.runAllTimersAsync();
    await outcome;

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails fast without retrying when every unresponsive engine is under a long suspension", async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        JSON.stringify({
          results: [],
          unresponsive_engines: [
            ["brave", "Suspended: too many requests"],
            ["duckduckgo", "CAPTCHA"],
          ],
        }),
      ),
    );
    const searchesWithUnresponsiveEngines =
      getSearchesWithUnresponsiveEnginesSinceLastRestart();

    const promise = fetchSearXNG("test", "text");
    const outcome = expect(promise).rejects.toThrow(
      "Unresponsive engines: brave (Suspended: too many requests), duckduckgo (CAPTCHA)",
    );
    // No backoff to drain: the all-suspended set throws on the first attempt
    // rather than spending the retry budget it could not possibly outlast.
    await vi.runAllTimersAsync();
    await outcome;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSearchesWithUnresponsiveEnginesSinceLastRestart()).toBe(
      searchesWithUnresponsiveEngines + 1,
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
          unresponsive_engines: [["google", "Timeout"]],
        }),
      ),
    );
    const searchesWithoutResults = getSearchesWithoutResultsSinceLastRestart();
    const searchesWithUnresponsiveEngines =
      getSearchesWithUnresponsiveEnginesSinceLastRestart();

    const search = fetchSearXNG("failure injection", "text", 30, breaker);
    const outcome = expect(search).rejects.toThrow("google (Timeout)");
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_TOTAL_MS);
    await outcome;

    expect(breaker.getState("searxng")).toBe("OPEN");
    // A transient reason (a timeout) can clear inside the backoff, so this
    // case keeps the full retry budget before the search fails, and the
    // counter lands when the attempts run out. A suspended set would fail
    // fast instead; that is covered separately in the retry logic tests.
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

  it("drops image results that carry no thumbnail URL", async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        JSON.stringify({
          results: [
            {
              title: "with thumbnail",
              url: "https://example.com/picture",
              category: "images",
              img_src: "https://example.com/picture.jpg",
              thumbnail_src: "https://example.com/thumbnail.jpg",
            },
            {
              title: "video without thumbnail",
              url: "https://example.com/watch",
              category: "videos",
              iframe_src: "https://example.com/embed",
            },
            {
              title: "image without thumbnail",
              url: "https://other.com/picture",
              category: "images",
              img_src: "https://other.com/picture.jpg",
            },
          ],
        }),
      ),
    );

    const results = await fetchSearXNG(
      "failure injection",
      "images",
      30,
      new CircuitBreaker(breakerOptions),
    );

    expect(results).toEqual([
      [
        "with thumbnail",
        "https://example.com/picture",
        "https://example.com/thumbnail.jpg",
        "https://example.com/picture.jpg",
      ],
    ]);
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

  function respondingEmptyResponse() {
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
    fetchMock.mockResolvedValue(respondingEmptyResponse());
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
    fetchMock.mockResolvedValue(respondingEmptyResponse());

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

describe("getWebSearchServiceStatus", () => {
  const healthzOk = () => fetchMock.mockResolvedValue(createMockResponse("OK"));

  const suspendedResponse = () =>
    createMockResponse(
      JSON.stringify({
        results: [],
        unresponsive_engines: [["google", "CAPTCHA"]],
      }),
    );

  /** Answered, matched nothing. Not to be confused with the empty responses
   *  elsewhere in this file, which carry unresponsive engines. */
  const respondingEmptyResponse = () =>
    createMockResponse(JSON.stringify({ results: [] }));

  /** Leaves no search type flagged, so a test starts from a known state. */
  async function clearDegradation(breaker: CircuitBreaker) {
    fetchMock.mockResolvedValue(respondingEmptyResponse());
    await fetchSearXNG("reset", "text", 30, breaker);
    await fetchSearXNG("reset", "images", 30, breaker);
    healthzOk();
    expect(await getWebSearchServiceStatus(breaker)).toBe("healthy");
  }

  it("reports unhealthy while the circuit is open, though /healthz answers OK", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    fetchMock.mockResolvedValue(createMockResponse("", false, 503));
    await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow();
    expect(breaker.getState("searxng")).toBe("OPEN");

    // SearXNG is listening, so the probe passes; every search still fails,
    // because the breaker answers them without reaching SearXNG at all.
    healthzOk();

    expect(await getWebSearchServiceStatus(breaker)).toBe("unhealthy");
  });

  it("reports unhealthy when the probe fails, before it looks at the circuit", async () => {
    vi.useFakeTimers();
    try {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 1000,
      });
      fetchMock.mockResolvedValue(createMockResponse("", false, 503));
      await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow();

      // Half-open, not open: the circuit check would answer "degraded" here, so
      // only a probe checked first can answer "unhealthy".
      await vi.advanceTimersByTimeAsync(1000);
      expect(breaker.getState("searxng")).toBe("HALF_OPEN");

      fetchMock.mockResolvedValue(createMockResponse("NOT_OK", false));

      expect(await getWebSearchServiceStatus(breaker)).toBe("unhealthy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports degraded while the circuit is half-open and nothing has proven it", async () => {
    vi.useFakeTimers();
    try {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 1000,
      });
      await clearDegradation(breaker);

      fetchMock.mockResolvedValue(createMockResponse("", false, 503));
      await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow();

      await vi.advanceTimersByTimeAsync(1000);
      expect(breaker.getState("searxng")).toBe("HALF_OPEN");

      healthzOk();

      // A 503 is not an engine failure, so nothing flagged a search type here:
      // the verdict has to come from the circuit alone.
      expect(await getWebSearchServiceStatus(breaker)).toBe("degraded");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports degraded after a search lost to unresponsive engines", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    await clearDegradation(breaker);

    fetchMock.mockResolvedValue(suspendedResponse());
    await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow(
      "google (CAPTCHA)",
    );
    expect(breaker.getState("searxng")).toBe("CLOSED");

    healthzOk();

    expect(await getWebSearchServiceStatus(breaker)).toBe("degraded");
  });

  it("stays degraded when an image search answers after a failed text search", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    await clearDegradation(breaker);

    fetchMock.mockResolvedValue(suspendedResponse());
    await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow();

    // What the client actually does after a failed text search: it fires an
    // image search, which goes out to a different engine pool. Answering there
    // says nothing about the text engines that just failed.
    fetchMock.mockResolvedValue(respondingEmptyResponse());
    await fetchSearXNG("test", "images", 30, breaker);

    healthzOk();

    expect(await getWebSearchServiceStatus(breaker)).toBe("degraded");
    expect(getDegradedSearchTypes()).toEqual(["text"]);
  });

  it("reports healthy again once SearXNG answers the search type that failed", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    await clearDegradation(breaker);

    fetchMock.mockResolvedValue(suspendedResponse());
    await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow();
    const tallyWhileDegraded = getUnresponsiveEngineStats();

    fetchMock.mockResolvedValue(successResponse());
    await fetchSearXNG("test", "text", 30, breaker);

    healthzOk();

    expect(await getWebSearchServiceStatus(breaker)).toBe("healthy");
    // Recovering clears the verdict, not the history: the tally is what an
    // operator reads after the fact to see which engines it was.
    expect(getUnresponsiveEngineStats()).toEqual(tallyWhileDegraded);
  });

  it("clears the degradation on zero results with no engine errors", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    await clearDegradation(breaker);

    fetchMock.mockResolvedValue(suspendedResponse());
    await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow();

    // The engines replied, they just matched nothing, which is not a failure.
    fetchMock.mockResolvedValue(respondingEmptyResponse());
    await fetchSearXNG("test", "text", 30, breaker);

    healthzOk();

    expect(await getWebSearchServiceStatus(breaker)).toBe("healthy");
  });

  it("counts each engine in a response separately", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    const before = getUnresponsiveEngineStats().bing?.failures ?? 0;
    fetchMock.mockResolvedValue(
      createMockResponse(
        JSON.stringify({
          results: [],
          unresponsive_engines: [
            ["bing", "Suspended: Access denied"],
            ["startpage", "Suspended: CAPTCHA"],
          ],
        }),
      ),
    );

    await expect(fetchSearXNG("test", "text", 30, breaker)).rejects.toThrow();

    // SearXNG's own wording never reaches the payload: `/status` is public and
    // the string is free-form text from an upstream engine.
    expect(getUnresponsiveEngineStats().bing).toEqual({
      failures: before + 1,
      lastFailure: "blocked",
    });
    expect(getUnresponsiveEngineStats().startpage).toMatchObject({
      lastFailure: "blocked",
    });
  });

  it("classifies a timeout apart from a block, and an unknown reason apart from both", async () => {
    vi.useFakeTimers();
    try {
      const breaker = new CircuitBreaker({ failureThreshold: 5 });
      fetchMock.mockResolvedValue(
        createMockResponse(
          JSON.stringify({
            results: [],
            unresponsive_engines: [
              ["qwant", "timeout"],
              // SearXNG benches an engine for generic errors too, and those
              // recover inside the backoff, so they must not read as blocked.
              ["mojeek", "Suspended: server API error"],
            ],
          }),
        ),
      );

      // Neither is a block, so this one spends the whole retry budget before it
      // is counted, unlike the blocked engines above.
      const search = fetchSearXNG("test", "text", 30, breaker);
      const outcome = expect(search).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(7000);
      await outcome;

      expect(getUnresponsiveEngineStats().qwant?.lastFailure).toBe("timeout");
      expect(getUnresponsiveEngineStats().mojeek?.lastFailure).toBe("other");
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the search types the verdict is about", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    await clearDegradation(breaker);
    expect(getDegradedSearchTypes()).toEqual([]);

    fetchMock.mockResolvedValue(suspendedResponse());
    await expect(fetchSearXNG("test", "images", 30, breaker)).rejects.toThrow();

    // Without this an operator alerting on a non-healthy status has no way to
    // tell which engine pool is the one still failing.
    expect(getDegradedSearchTypes()).toEqual(["images"]);
  });

  it("ignores an entry that names no engine", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    const searchesWithoutResults = getSearchesWithoutResultsSinceLastRestart();
    fetchMock.mockResolvedValue(
      createMockResponse(
        JSON.stringify({ results: [], unresponsive_engines: [[""]] }),
      ),
    );

    // Nothing to report, so it takes the genuinely-empty path rather than
    // retrying and tallying under an empty engine name.
    await expect(fetchSearXNG("test", "text", 30, breaker)).resolves.toEqual(
      [],
    );
    expect(getSearchesWithoutResultsSinceLastRestart()).toBe(
      searchesWithoutResults + 1,
    );
    expect(getUnresponsiveEngineStats()[""]).toBeUndefined();
  });
});
