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

function createMockResponse(
  body: string,
  {
    status,
    ok = status === undefined ? true : status >= 200 && status < 300,
    headers = {},
    contentType = "application/json",
    unreadBody = null,
  }: {
    ok?: boolean;
    status?: number;
    headers?: Record<string, string>;
    contentType?: string;
    unreadBody?: { cancel: () => Promise<void> } | null;
  } = {},
): Response {
  const resolvedStatus = status ?? (ok ? 200 : 503);
  return {
    ok,
    status: resolvedStatus,
    statusText: ok ? "OK" : "Error",
    headers: new Headers({ "content-type": contentType, ...headers }),
    redirected: false,
    type: "basic" as ResponseType,
    url: "http://test.com",
    clone: function () {
      return this;
    },
    body: unreadBody,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

const SESSION_ID = "session-from-step-one";
const QUERY = "borogoves outgrabe mimsy-42";
// The module's own cap on the exchange; every test that is not about the
// caller's budget passes it as the budget.
const FULL_BUDGET_MS = 15_000;

const INITIALIZE_REPLY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: {} },
});

const NOTIFICATION_ACCEPTED = "";

function toolReply(document: unknown): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    result: {
      content: [{ type: "text", text: JSON.stringify(document) }],
    },
  });
}

function sseReply(message: string): string {
  return `event: message\ndata: ${message}\n\n`;
}

function documentWith(results: unknown[]): string {
  return toolReply({ search_id: "search-1", results });
}

// You.com's reply wraps its web results one level deeper, under
// `results.web`, and each result carries a description and, when the query
// matched the page, query-relevant highlights.
function youcomDocumentWith(web: unknown[]): string {
  return toolReply({ results: { web } });
}

const PARALLEL_URL = "https://search.parallel.ai/mcp";
const YOUCOM_KEYLESS_URL = "https://api.you.com/mcp?profile=free";
const YOUCOM_AUTHENTICATED_URL = "https://api.you.com/mcp";

const DESCRIPTION =
  "A plain description that You.com returns for a page that matched the query, long enough to read as a summary.";

const EXCERPT =
  "The opening sentence of a very long excerpt that has to survive the filter. alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec";

const LONG_EXCERPT = `${EXCERPT} romeo sierra tango uniform victor whiskey xray yankee zulu alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu`;

let originalFetch: typeof fetch;
let fetchMock: MockedFunction<typeof fetch>;

type FallbackModule = typeof import("./fallbackSearchService");
let fetchFallbackTextResults: FallbackModule["fetchFallbackTextResults"];
let isSearchFallbackEnabled: FallbackModule["isSearchFallbackEnabled"];
let assertSearchFallbackConfiguration: FallbackModule["assertSearchFallbackConfiguration"];
let getFallbackProviderStats: FallbackModule["getFallbackProviderStats"];

const FALLBACK_VARIABLES = [
  "SEARCH_FALLBACK_ENABLED",
  "SEARCH_FALLBACK_PROVIDERS",
  "SEARCH_FALLBACK_PARALLEL_API_KEY",
  "SEARCH_FALLBACK_YOUCOM_API_KEY",
  "SEARCH_FALLBACK_PROVIDER",
  "SEARCH_FALLBACK_API_KEY",
] as const;
const originalVariables = Object.fromEntries(
  FALLBACK_VARIABLES.map((name) => [name, process.env[name]]),
);

beforeEach(async () => {
  for (const name of FALLBACK_VARIABLES) delete process.env[name];
  // Pinned to one provider so the tests below that are about one exchange
  // run it alone, without the shuffle; the cascade tests clear it.
  process.env.SEARCH_FALLBACK_PROVIDERS = "parallel";
  originalFetch = global.fetch;
  fetchMock = vi.fn() as unknown as MockedFunction<typeof fetch>;
  global.fetch = fetchMock;
  // A fresh module per test: pauses and counters are process state, and one
  // test's 429 must not leave a provider boxed for the next.
  vi.resetModules();
  ({
    fetchFallbackTextResults,
    isSearchFallbackEnabled,
    assertSearchFallbackConfiguration,
    getFallbackProviderStats,
  } = await import("./fallbackSearchService"));
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const name of FALLBACK_VARIABLES) {
    const original = originalVariables[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Answers the requests in order with the given tool-call reply. */
function mockExchange(
  toolBody: string,
  {
    initializeBody = INITIALIZE_REPLY,
    initializeContentType = "application/json",
    toolContentType = "application/json",
    initializeSession = SESSION_ID,
  }: {
    initializeBody?: string;
    initializeContentType?: string;
    toolContentType?: string;
    initializeSession?: string | null;
  } = {},
) {
  fetchMock.mockResolvedValueOnce(
    createMockResponse(initializeBody, {
      contentType: initializeContentType,
      headers: initializeSession ? { "mcp-session-id": initializeSession } : {},
    }),
  );

  // A stateless initialize answers no session, so the initialized
  // notification never goes out and the tool call follows at once.
  if (initializeSession) {
    fetchMock.mockResolvedValueOnce(
      createMockResponse(NOTIFICATION_ACCEPTED, { status: 202 }),
    );
  }

  fetchMock.mockResolvedValueOnce(
    createMockResponse(toolBody, { contentType: toolContentType }),
  );
}

function requestBody(index: number): {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
    capabilities?: unknown;
    clientInfo?: unknown;
  };
} {
  const [, init] = fetchMock.mock.calls[index];
  return JSON.parse(String(init?.body));
}

function requestHeaders(index: number): Record<string, string> {
  const [, init] = fetchMock.mock.calls[index];
  return init?.headers as Record<string, string>;
}

describe("isSearchFallbackEnabled", () => {
  it("is off when the variable is unset", () => {
    expect(isSearchFallbackEnabled()).toBe(false);
  });

  it("accepts 'true' and ' TRUE ' and '1'", () => {
    process.env.SEARCH_FALLBACK_ENABLED = "true";
    expect(isSearchFallbackEnabled()).toBe(true);

    process.env.SEARCH_FALLBACK_ENABLED = " TRUE ";
    expect(isSearchFallbackEnabled()).toBe(true);

    process.env.SEARCH_FALLBACK_ENABLED = "1";
    expect(isSearchFallbackEnabled()).toBe(true);
  });

  it("rejects a value that is not true or 1", () => {
    process.env.SEARCH_FALLBACK_ENABLED = "yes";
    expect(isSearchFallbackEnabled()).toBe(false);
  });

  it("reads the variable at call time", () => {
    expect(isSearchFallbackEnabled()).toBe(false);
    process.env.SEARCH_FALLBACK_ENABLED = "true";
    expect(isSearchFallbackEnabled()).toBe(true);
  });
});

describe("the three requests", () => {
  it("runs initialize, the initialized notification and the tool call in order", async () => {
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestBody(0)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "MiniSearch", version: "1" },
      },
    });
    expect(requestBody(1)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(requestBody(2).method).toBe("tools/call");
    expect(requestBody(2).params?.name).toBe("web_search");
    expect(requestBody(2).params?.arguments).toEqual({
      objective: QUERY,
      search_queries: [QUERY],
      session_id: expect.any(String),
    });
  });

  it("carries the session id from step 1 onto steps 2 and 3, with the protocol version", async () => {
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(requestHeaders(0)["Mcp-Session-Id"]).toBeUndefined();
    expect(requestHeaders(0)["MCP-Protocol-Version"]).toBeUndefined();

    for (const index of [1, 2]) {
      expect(requestHeaders(index)["Mcp-Session-Id"]).toBe(SESSION_ID);
      expect(requestHeaders(index)["MCP-Protocol-Version"]).toBe("2025-06-18");
    }
  });

  it("sends one session id for the process, not one per search", async () => {
    mockExchange(documentWith([]));
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);
    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    const first = requestBody(2).params?.arguments?.session_id;
    const second = requestBody(5).params?.arguments?.session_id;
    expect(typeof first).toBe("string");
    expect(second).toBe(first);
  });

  it("sends the content type and accept header on every request", async () => {
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    for (let index = 0; index < 3; index++) {
      const headers = requestHeaders(index);
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers.Accept).toBe("application/json, text/event-stream");
    }
  });

  it("never sends a model name", async () => {
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    const toolCall = JSON.stringify(fetchMock.mock.calls[2][1]?.body);
    expect(toolCall).not.toContain("model_name");
    expect(Object.keys(requestBody(2).params?.arguments ?? {})).toEqual([
      "objective",
      "search_queries",
      "session_id",
    ]);
  });

  it("bounds all three requests with one abort signal", async () => {
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    const signals = fetchMock.mock.calls.map(([, init]) => init?.signal);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBe(signals[0]);
    expect(signals[2]).toBe(signals[0]);
  });

  it("hands the exchange the caller's budget, capped at its own", async () => {
    mockExchange(documentWith([]));
    mockExchange(documentWith([]));
    // A frozen clock, so the remaining budget is exactly what was passed in.
    vi.useFakeTimers({ toFake: ["Date"] });
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await fetchFallbackTextResults(QUERY, 10, 3_000);
    await fetchFallbackTextResults(QUERY, 10, 20_000);

    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 3_000);
    // A budget past the module's own 15 s is not passed on: the exchange still
    // ends at the cap, so the caller cannot lend it more time than it allows.
    // Restored by the afterEach below, along with every other mock.
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 15_000);
  });

  it("discards the unread bodies of the first two responses", async () => {
    const cancelInitialize = vi.fn().mockResolvedValue(undefined);
    const cancelInitialized = vi.fn().mockResolvedValue(undefined);
    fetchMock
      .mockResolvedValueOnce(
        createMockResponse(INITIALIZE_REPLY, {
          headers: { "mcp-session-id": SESSION_ID },
          unreadBody: { cancel: cancelInitialize },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse(NOTIFICATION_ACCEPTED, {
          status: 202,
          unreadBody: { cancel: cancelInitialized },
        }),
      )
      .mockResolvedValueOnce(createMockResponse(documentWith([])));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    // An unread body keeps its socket out of the connection pool until it is
    // collected, so the two replies nobody reads have to be dropped.
    expect(cancelInitialize).toHaveBeenCalledTimes(1);
    expect(cancelInitialized).toHaveBeenCalledTimes(1);
  });

  it("discards an unread body before throwing on a rejected initialize", async () => {
    const cancelInitialize = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValueOnce(
      createMockResponse("", {
        status: 500,
        unreadBody: { cancel: cancelInitialize },
      }),
    );

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("did not answer the initialize request (status 500)");
    expect(cancelInitialize).toHaveBeenCalledTimes(1);
  });

  it("omits the Bearer header when no key is configured", async () => {
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    for (let index = 0; index < 3; index++) {
      expect(requestHeaders(index).Authorization).toBeUndefined();
    }
  });

  it("sends the Bearer header on every request when a key is configured", async () => {
    process.env.SEARCH_FALLBACK_PARALLEL_API_KEY = "sk-fallback-key";
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    for (let index = 0; index < 3; index++) {
      expect(requestHeaders(index).Authorization).toBe(
        "Bearer sk-fallback-key",
      );
    }
  });

  it("treats a whitespace-only key as no key", async () => {
    process.env.SEARCH_FALLBACK_PARALLEL_API_KEY = "   ";
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(requestHeaders(0).Authorization).toBeUndefined();
  });
});

describe("choosing the provider", () => {
  it("runs the Parallel exchange by default", async () => {
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [requestUrl] of fetchMock.mock.calls) {
      expect(String(requestUrl)).toBe(PARALLEL_URL);
    }
    expect(requestBody(2).params?.name).toBe("web_search");
  });

  it("runs the You.com exchange when SEARCH_FALLBACK_PROVIDERS lists youcom", async () => {
    process.env.SEARCH_FALLBACK_PROVIDERS = "youcom";
    mockExchange(youcomDocumentWith([]), { initializeSession: null });

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [requestUrl] of fetchMock.mock.calls) {
      expect(String(requestUrl)).toBe(YOUCOM_KEYLESS_URL);
    }
    expect(requestBody(1).params?.name).toBe("you-search");
    expect(requestBody(1).params?.arguments).toEqual({
      query: QUERY,
      count: 10,
    });
  });

  it("sends the protocol version but no session id when You.com opens no session", async () => {
    process.env.SEARCH_FALLBACK_PROVIDERS = "youcom";
    mockExchange(youcomDocumentWith([]), { initializeSession: null });

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(1).method).toBe("tools/call");
    for (const index of [0, 1]) {
      expect(requestHeaders(index)["Mcp-Session-Id"]).toBeUndefined();
    }
    expect(requestHeaders(0)["MCP-Protocol-Version"]).toBeUndefined();
    expect(requestHeaders(1)["MCP-Protocol-Version"]).toBe("2025-06-18");
  });

  it("acknowledges a session and carries it when You.com opens one", async () => {
    process.env.SEARCH_FALLBACK_PROVIDERS = "youcom";
    mockExchange(youcomDocumentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestBody(1).method).toBe("notifications/initialized");
    for (const index of [1, 2]) {
      expect(requestHeaders(index)["Mcp-Session-Id"]).toBe(SESSION_ID);
    }
  });

  it("uses You.com's authenticated endpoint and the Bearer key when a key is set", async () => {
    process.env.SEARCH_FALLBACK_PROVIDERS = "youcom";
    process.env.SEARCH_FALLBACK_YOUCOM_API_KEY = "***";
    mockExchange(youcomDocumentWith([]), { initializeSession: null });

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    for (const [requestUrl] of fetchMock.mock.calls) {
      expect(String(requestUrl)).toBe(YOUCOM_AUTHENTICATED_URL);
    }
    for (const index of [0, 1]) {
      expect(requestHeaders(index).Authorization).toBe("Bearer ***");
    }
  });
});

describe("mapping You.com results", () => {
  const runYoucom = async (web: unknown[], limit = 10) => {
    process.env.SEARCH_FALLBACK_PROVIDERS = "youcom";
    mockExchange(youcomDocumentWith(web), { initializeSession: null });
    return fetchFallbackTextResults(QUERY, limit, FULL_BUDGET_MS);
  };

  it("uses the description as the snippet, collapsed to one line", async () => {
    const results = await runYoucom([
      {
        url: "https://example.com/described",
        title: "Described",
        description: "A description with\n\nnewlines and   extra spaces in it.",
      },
    ]);

    expect(results).toEqual([
      [
        "Described",
        "A description with newlines and extra spaces in it.",
        "https://example.com/described",
      ],
    ]);
  });

  it("truncates a long description at a word boundary", async () => {
    const description = `${EXCERPT} ${LONG_EXCERPT}`;
    expect(description.length).toBeGreaterThan(400);

    const results = await runYoucom([
      {
        url: "https://example.com/long",
        title: "Long",
        description,
      },
    ]);

    const snippet = results[0][1];
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(400);
    const kept = snippet.slice(0, -1);
    // The kept text is a prefix of the collapsed source, and the source
    // continues with a space, so the cut landed between two words rather
    // than inside one.
    expect(description.startsWith(kept)).toBe(true);
    expect(description[kept.length]).toBe(" ");
  });

  it("keeps a short description that the excerpt length filter would drop", async () => {
    const results = await runYoucom([
      {
        url: "https://example.com/terse",
        title: "Terse",
        description: "Terse.",
      },
    ]);

    expect(results).toEqual([["Terse", "Terse.", "https://example.com/terse"]]);
  });

  it("falls back to the highlights when the description is empty or null", async () => {
    const results = await runYoucom([
      {
        url: "https://example.com/empty",
        title: "Empty",
        description: "",
        contents: { highlights: ["Skip to main content", EXCERPT] },
      },
      {
        url: "https://example.com/null",
        title: "Null",
        description: null,
        contents: { highlights: [EXCERPT] },
      },
    ]);

    expect(results).toEqual([
      ["Empty", EXCERPT, "https://example.com/empty"],
      ["Null", EXCERPT, "https://example.com/null"],
    ]);
  });

  it("drops a result with no url, a null or empty title, or no snippet", async () => {
    const results = await runYoucom([
      { title: "No url", description: DESCRIPTION },
      {
        url: "https://example.com/null-title",
        title: null,
        description: DESCRIPTION,
      },
      {
        url: "https://example.com/empty-title",
        title: "   ",
        description: DESCRIPTION,
      },
      {
        url: "https://example.com/no-snippet",
        title: "No snippet",
        description: "",
      },
      {
        url: "https://example.com/crumb-only",
        title: "Crumb only",
        description: "",
        contents: { highlights: ["Skip to main content"] },
      },
      {
        url: "https://example.com/kept",
        title: "Kept",
        description: DESCRIPTION,
      },
    ]);

    expect(results).toEqual([
      ["Kept", DESCRIPTION, "https://example.com/kept"],
    ]);
  });

  it("drops a result whose url or title is not a string", async () => {
    const results = await runYoucom([
      { url: 42, title: "Number url", description: DESCRIPTION },
      { url: null, title: "Null url", description: DESCRIPTION },
      {
        url: "https://example.com/number-title",
        title: 7,
        description: DESCRIPTION,
      },
      null,
      {
        url: "https://example.com/kept",
        title: "Kept",
        description: DESCRIPTION,
      },
    ]);

    // One malformed entry must not take the rest of the search down with it.
    expect(results).toEqual([
      ["Kept", DESCRIPTION, "https://example.com/kept"],
    ]);
  });

  it("drops duplicate urls in the endpoint's order", async () => {
    const results = await runYoucom([
      {
        url: "https://example.com/dup",
        title: "First",
        description: DESCRIPTION,
      },
      {
        url: "https://example.com/other",
        title: "Second",
        description: DESCRIPTION,
      },
      {
        url: "https://example.com/dup",
        title: "Third",
        description: DESCRIPTION,
      },
    ]);

    expect(results.map(([title]) => title)).toEqual(["First", "Second"]);
  });

  it("keeps the endpoint's relevance order and applies the limit", async () => {
    const results = await runYoucom(
      [
        {
          url: "https://example.com/1",
          title: "One",
          description: DESCRIPTION,
        },
        {
          url: "https://example.com/2",
          title: "Two",
          description: DESCRIPTION,
        },
        {
          url: "https://example.com/3",
          title: "Three",
          description: DESCRIPTION,
        },
      ],
      2,
    );

    expect(results.map(([title]) => title)).toEqual(["One", "Two"]);
  });

  it("throws when the document has no web results array", async () => {
    process.env.SEARCH_FALLBACK_PROVIDERS = "youcom";
    mockExchange(toolReply({ results: {} }), { initializeSession: null });

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("without a web results array");
  });

  it("reads the id-matched reply out of an SSE stream that carries a notification first", async () => {
    process.env.SEARCH_FALLBACK_PROVIDERS = "youcom";
    mockExchange(
      `${sseReply(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: {
            level: "info",
            data: `Search successful for query: ${QUERY} - 20 web results`,
          },
        }),
      )}${sseReply(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  results: {
                    web: [
                      {
                        url: "https://example.com/sse",
                        title: "SSE",
                        description: DESCRIPTION,
                      },
                    ],
                  },
                }),
              },
            ],
          },
        }),
      )}`,
      { initializeSession: null, toolContentType: "text/event-stream" },
    );

    const results = await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(results).toEqual([["SSE", DESCRIPTION, "https://example.com/sse"]]);
  });
});

describe("reading the reply", () => {
  it("parses an application/json reply", async () => {
    mockExchange(
      toolReply({
        search_id: "search-1",
        results: [
          {
            url: "https://example.com/json",
            title: "JSON title",
            excerpts: [
              `${"json ".repeat(12).trim()} an excerpt long enough to be kept by the length filter.`,
            ],
          },
        ],
      }),
    );

    const results = await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(results).toHaveLength(1);
    expect(results[0][0]).toBe("JSON title");
    expect(results[0][2]).toBe("https://example.com/json");
  });

  it("parses a text/event-stream reply and skips blocks that are not JSON", async () => {
    mockExchange(
      `: keep-alive\n\n${sseReply(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: {
            content: [{ type: "text", text: JSON.stringify({ results: [] }) }],
          },
        }),
      )}event: ping\ndata: not json\n\n`,
      { toolContentType: "text/event-stream" },
    );

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).resolves.toEqual([]);
  });

  it("parses an SSE initialize reply", async () => {
    mockExchange(documentWith([]), {
      initializeBody: sseReply(INITIALIZE_REPLY),
      initializeContentType: "text/event-stream",
    });

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).resolves.toEqual([]);
  });

  it("returns an empty array when nothing usable comes back", async () => {
    mockExchange(documentWith([]));

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).resolves.toEqual([]);
  });
});

describe("mapping a result", () => {
  const run = async (results: unknown[], limit = 10) => {
    mockExchange(documentWith(results));
    return fetchFallbackTextResults(QUERY, limit, FULL_BUDGET_MS);
  };

  it("drops navigation crumbs and keeps the paragraph", async () => {
    const results = await run([
      {
        url: "https://example.com/guide",
        title: "Guide",
        excerpts: [
          "Skip to main content",
          "Home > Docs > Search > Guide",
          EXCERPT,
        ],
      },
    ]);

    expect(results).toEqual([["Guide", EXCERPT, "https://example.com/guide"]]);
  });

  it("strips leading markdown markers", async () => {
    const results = await run([
      {
        url: "https://example.com/markers",
        title: "Markers",
        excerpts: [`# ${EXCERPT}`],
      },
    ]);

    expect(results[0][1]).toBe(EXCERPT);
  });

  it("reduces a markdown link to its text", async () => {
    const results = await run([
      {
        url: "https://example.com/link",
        title: "Link",
        excerpts: [
          `See the [reference page](https://example.com/reference) and then ${EXCERPT}`,
        ],
      },
    ]);

    expect(results[0][1]).toBe(`See the reference page and then ${EXCERPT}`);
  });

  it("joins excerpts and collapses the whitespace between them", async () => {
    const first = `The first excerpt paragraph is long enough to be kept intact.`;
    const second = `The second excerpt paragraph is long enough to be kept intact.`;
    const results = await run([
      {
        url: "https://example.com/join",
        title: "Join",
        excerpts: [`${first}\n\n${second}`, "Short"],
      },
    ]);

    expect(results[0][1]).toBe(`${first} ${second}`);
  });

  it("cuts at 400 characters, at a word boundary, and marks the cut", async () => {
    expect(LONG_EXCERPT.length).toBeGreaterThan(400);

    const results = await run([
      {
        url: "https://example.com/long",
        title: "Long",
        excerpts: [LONG_EXCERPT],
      },
    ]);

    const snippet = results[0][1];
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(400);
    const kept = snippet.slice(0, -1);
    // The kept text is a prefix of the source, and the source continues with a
    // space, so the cut landed between two words rather than inside one.
    expect(LONG_EXCERPT.startsWith(kept)).toBe(true);
    expect(LONG_EXCERPT[kept.length]).toBe(" ");
  });

  it("leaves a snippet that fits untouched", async () => {
    expect(EXCERPT.length).toBeLessThanOrEqual(400);

    const results = await run([
      { url: "https://example.com/short", title: "Short", excerpts: [EXCERPT] },
    ]);

    expect(results[0][1]).toBe(EXCERPT);
    expect(results[0][1]).not.toContain("…");
  });

  it("drops a result with no url, a null or empty title, or an empty snippet", async () => {
    const results = await run([
      { title: "No url", excerpts: [EXCERPT] },
      {
        url: "https://example.com/null-title",
        title: null,
        excerpts: [EXCERPT],
      },
      {
        url: "https://example.com/empty-title",
        title: "   ",
        excerpts: [EXCERPT],
      },
      {
        url: "https://example.com/no-snippet",
        title: "No snippet",
        excerpts: [],
      },
      {
        url: "https://example.com/crumb-only",
        title: "Crumb only",
        excerpts: ["Skip to main content"],
      },
      { url: "https://example.com/kept", title: "Kept", excerpts: [EXCERPT] },
    ]);

    expect(results).toEqual([["Kept", EXCERPT, "https://example.com/kept"]]);
  });

  it("drops a result whose url or title is not a string", async () => {
    const results = await run([
      { url: 42, title: "Number url", excerpts: [EXCERPT] },
      { url: null, title: "Null url", excerpts: [EXCERPT] },
      {
        url: "https://example.com/number-title",
        title: 7,
        excerpts: [EXCERPT],
      },
      null,
      { url: "https://example.com/kept", title: "Kept", excerpts: [EXCERPT] },
    ]);

    // One malformed entry must not take the rest of the search down with it.
    expect(results).toEqual([["Kept", EXCERPT, "https://example.com/kept"]]);
  });

  it("drops duplicate urls in the endpoint's order", async () => {
    const results = await run([
      { url: "https://example.com/dup", title: "First", excerpts: [EXCERPT] },
      {
        url: "https://example.com/other",
        title: "Second",
        excerpts: [EXCERPT],
      },
      { url: "https://example.com/dup", title: "Third", excerpts: [EXCERPT] },
    ]);

    expect(results.map(([title]) => title)).toEqual(["First", "Second"]);
  });

  it("keeps the endpoint's relevance order", async () => {
    const results = await run([
      { url: "https://example.com/1", title: "One", excerpts: [EXCERPT] },
      { url: "https://example.com/2", title: "Two", excerpts: [EXCERPT] },
      { url: "https://example.com/3", title: "Three", excerpts: [EXCERPT] },
    ]);

    expect(results.map(([title]) => title)).toEqual(["One", "Two", "Three"]);
  });

  it("applies the limit", async () => {
    const results = await run(
      [
        { url: "https://example.com/1", title: "One", excerpts: [EXCERPT] },
        { url: "https://example.com/2", title: "Two", excerpts: [EXCERPT] },
        { url: "https://example.com/3", title: "Three", excerpts: [EXCERPT] },
      ],
      2,
    );

    expect(results.map(([title]) => title)).toEqual(["One", "Two"]);
  });
});

describe("failures", () => {
  it("throws when the You.com initialize request fails", async () => {
    process.env.SEARCH_FALLBACK_PROVIDERS = "youcom";
    const cancel = vi.fn(async () => undefined);
    fetchMock.mockResolvedValueOnce(
      createMockResponse("", { status: 500, unreadBody: { cancel } }),
    );

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("did not answer the initialize request (status 500)");
    // An unread body keeps undici's socket out of the pool until it is
    // garbage-collected, so the non-2xx path has to discard it; dropping
    // that line fails here.
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the tool call is not 2xx", async () => {
    const cancel = vi.fn(async () => undefined);
    fetchMock.mockResolvedValueOnce(
      createMockResponse(INITIALIZE_REPLY, {
        headers: { "mcp-session-id": SESSION_ID },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      createMockResponse(NOTIFICATION_ACCEPTED, { status: 202 }),
    );
    fetchMock.mockResolvedValueOnce(
      createMockResponse("bad", { status: 502, unreadBody: { cancel } }),
    );

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("The fallback search tool call failed with status 502");
    // An unread body keeps undici's socket out of the pool until it is
    // garbage-collected, so the non-2xx path has to discard it like the two
    // paths above it; dropping that line fails here.
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("skips the notification when Parallel opens no session", async () => {
    mockExchange(documentWith([]), { initializeSession: null });

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    // The session is optional for every provider: with none opened, the tool
    // call follows initialize directly and carries no session headers.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(1).method).toBe("tools/call");
    expect(requestHeaders(1)["Mcp-Session-Id"]).toBeUndefined();
  });

  it("throws on a JSON-RPC error and keeps the endpoint's message out of it", async () => {
    fetchMock.mockResolvedValueOnce(
      createMockResponse(INITIALIZE_REPLY, {
        headers: { "mcp-session-id": SESSION_ID },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      createMockResponse(NOTIFICATION_ACCEPTED, { status: 202 }),
    );
    fetchMock.mockResolvedValueOnce(
      createMockResponse(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          error: { code: -32601, message: "SECRET UPSTREAM TEXT" },
        }),
      ),
    );

    const rejection = await fetchFallbackTextResults(
      QUERY,
      10,
      FULL_BUDGET_MS,
    ).catch((error: unknown) => error);
    // The whole message is fixed text plus the code: an upstream message is
    // free-form text from a third party and must not travel any further.
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      "Every fallback search provider failed (parallel: The fallback search endpoint returned a JSON-RPC error (code -32601))",
    );
    expect(String(rejection)).not.toContain("SECRET UPSTREAM TEXT");
  });

  it("keeps a non-numeric JSON-RPC code out of the message", async () => {
    fetchMock.mockResolvedValueOnce(
      createMockResponse(INITIALIZE_REPLY, {
        headers: { "mcp-session-id": SESSION_ID },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      createMockResponse(NOTIFICATION_ACCEPTED, { status: 202 }),
    );
    fetchMock.mockResolvedValueOnce(
      createMockResponse(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          error: { code: "SECRET", message: "SECRET UPSTREAM TEXT" },
        }),
      ),
    );

    const rejection = await fetchFallbackTextResults(
      QUERY,
      10,
      FULL_BUDGET_MS,
    ).catch((error: unknown) => error);
    // A code is upstream data like the message is, so only a number may be
    // carried into the thrown error.
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      "Every fallback search provider failed (parallel: The fallback search endpoint returned a JSON-RPC error)",
    );
    expect(String(rejection)).not.toContain("SECRET");
  });

  it("throws when the result is marked as an error", async () => {
    mockExchange(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: {
          isError: true,
          content: [{ type: "text", text: "upstream refused" }],
        },
      }),
    );

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("reported the search as failed");
  });

  it("throws when the tool output is not JSON", async () => {
    mockExchange(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "<html>gateway</html>" }] },
      }),
    );

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("tool output that is not JSON");
  });

  it("throws a fixed message when the reply itself is not JSON", async () => {
    mockExchange("<html>gateway</html>");

    const rejection = await fetchFallbackTextResults(
      QUERY,
      10,
      FULL_BUDGET_MS,
    ).catch((error: unknown) => error);
    // A raw SyntaxError quotes the offending body, which would put the
    // upstream response into the thrown error and then into the log.
    expect((rejection as Error).message).toBe(
      "Every fallback search provider failed (parallel: The fallback search endpoint sent a reply that is not JSON)",
    );
    expect(String(rejection)).not.toContain("<html>");
  });

  it("throws when the document has no results array", async () => {
    mockExchange(toolReply({ search_id: "search-1" }));

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("without a results array");
  });

  it("throws when the endpoint is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("Network failure"));

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("Network failure");
  });
});

describe("privacy", () => {
  let logLines: string[];
  let originalLog: typeof debug.log;

  beforeEach(() => {
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
    debug.log = originalLog;
  });

  it("never writes the query, the API key or the response text to the log", async () => {
    process.env.SEARCH_FALLBACK_PARALLEL_API_KEY = "sk-fallback-key";
    mockExchange(
      documentWith([
        {
          url: "https://example.com/private",
          title: "PRIVATE RESPONSE TITLE",
          excerpts: [
            `PRIVATE RESPONSE EXCERPT that is long enough to be kept by the length filter and returned to the caller.`,
          ],
        },
      ]),
    );

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    // Failure paths too: they carry a fixed line plus a status or an error
    // code, never the payload.
    fetchMock.mockResolvedValueOnce(createMockResponse("", { status: 500 }));
    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow();

    const output = logLines.join("\n");
    for (const form of [
      QUERY,
      encodeURIComponent(QUERY),
      QUERY.replaceAll(" ", "+"),
      "PRIVATE RESPONSE TITLE",
      "PRIVATE RESPONSE EXCERPT",
      "sk-fallback-key",
    ]) {
      expect(output).not.toContain(form);
    }
    expect(logLines.length).toBeGreaterThan(0);
  });

  it("never writes the You.com query, the API key or the response text to the log", async () => {
    process.env.SEARCH_FALLBACK_PROVIDERS = "youcom";
    process.env.SEARCH_FALLBACK_YOUCOM_API_KEY = "youcom-fallback-key";
    mockExchange(
      youcomDocumentWith([
        {
          url: "https://example.com/private",
          title: "PRIVATE RESPONSE TITLE",
          description: "PRIVATE RESPONSE DESCRIPTION",
        },
      ]),
      { initializeSession: null },
    );

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    // The stream the endpoint answers with carries the query inside a
    // notification before the reply, so this also covers that path: none of
    // it may reach the log, only the counts do.
    const output = logLines.join("\n");
    for (const form of [
      QUERY,
      "PRIVATE RESPONSE TITLE",
      "PRIVATE RESPONSE DESCRIPTION",
      "youcom-fallback-key",
    ]) {
      expect(output).not.toContain(form);
    }
    expect(logLines.length).toBeGreaterThan(0);
  });
});

// Indexed by name rather than dotted, so each variable is spelled once.
const PROVIDERS_VARIABLE = "SEARCH_FALLBACK_PROVIDERS";
const PARALLEL_KEY_VARIABLE = "SEARCH_FALLBACK_PARALLEL_API_KEY";
const YOUCOM_KEY_VARIABLE = "SEARCH_FALLBACK_YOUCOM_API_KEY";
const LEGACY_PROVIDER_VARIABLE = "SEARCH_FALLBACK_PROVIDER";
const LEGACY_KEY_VARIABLE = "SEARCH_FALLBACK_API_KEY";

function listProviders(value: string | undefined) {
  if (value === undefined) delete process.env[PROVIDERS_VARIABLE];
  else process.env[PROVIDERS_VARIABLE] = value;
}

// Fisher-Yates over the two built-in providers draws once: 0 swaps them,
// anything near 1 keeps the table's order.
function orderYoucomFirst() {
  return vi.spyOn(Math, "random").mockReturnValue(0);
}

function orderParallelFirst() {
  return vi.spyOn(Math, "random").mockReturnValue(0.99);
}

function mockYoucom(web: unknown[]) {
  mockExchange(youcomDocumentWith(web), { initializeSession: null });
}

function requestUrls(): string[] {
  return fetchMock.mock.calls.map(([requestUrl]) => String(requestUrl));
}

function rateLimited(headers: Record<string, string> = {}) {
  return createMockResponse("", { status: 429, headers });
}

const SERVED_RESULT = {
  url: "https://example.com/served",
  title: "Served",
  description: DESCRIPTION,
};

describe("configuration", () => {
  it("tries every built-in provider when the list is unset", async () => {
    listProviders(undefined);
    orderParallelFirst();
    mockExchange(documentWith([]));
    mockYoucom([]);

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(new Set(requestUrls())).toEqual(
      new Set([PARALLEL_URL, YOUCOM_KEYLESS_URL]),
    );
  });

  it("tries only the listed providers, trimmed, lowercased and without empty items", async () => {
    listProviders(" YouCom ,, ");
    mockYoucom([]);

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(requestUrls()).toEqual([YOUCOM_KEYLESS_URL, YOUCOM_KEYLESS_URL]);
    expect(() => assertSearchFallbackConfiguration()).not.toThrow();
  });

  it("throws on an unknown provider name, naming it and the valid ones", async () => {
    listProviders("parallel, Bing");

    expect(() => assertSearchFallbackConfiguration()).toThrow(
      "SEARCH_FALLBACK_PROVIDERS has unknown provider names: bing; valid names: parallel, youcom.",
    );
    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("unknown provider names: bing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a list with no names in it", () => {
    listProviders(",");

    expect(() => assertSearchFallbackConfiguration()).toThrow(
      "SEARCH_FALLBACK_PROVIDERS lists no provider",
    );
  });

  it("throws when the removed SEARCH_FALLBACK_PROVIDER is set, naming its replacement", () => {
    process.env[LEGACY_PROVIDER_VARIABLE] = "youcom";

    expect(() => assertSearchFallbackConfiguration()).toThrow(
      "SEARCH_FALLBACK_PROVIDER is no longer read; set SEARCH_FALLBACK_PROVIDERS instead.",
    );
  });

  it("throws when the removed SEARCH_FALLBACK_API_KEY is set, naming both replacements and not the key", async () => {
    process.env[LEGACY_KEY_VARIABLE] = "legacy-test-value";

    const error = (() => {
      try {
        assertSearchFallbackConfiguration();
      } catch (thrown) {
        return thrown as Error;
      }
    })();

    expect(error?.message).toBe(
      "SEARCH_FALLBACK_API_KEY is no longer read; set SEARCH_FALLBACK_PARALLEL_API_KEY or SEARCH_FALLBACK_YOUCOM_API_KEY instead.",
    );
    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("SEARCH_FALLBACK_API_KEY is no longer read");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a key with a control character inside, naming the variable and not the key", async () => {
    process.env[YOUCOM_KEY_VARIABLE] = "youcom-test\nvalue";

    expect(() => assertSearchFallbackConfiguration()).toThrow(
      "SEARCH_FALLBACK_YOUCOM_API_KEY contains a control character; set it to the key alone.",
    );
    const error = (await fetchFallbackTextResults(
      QUERY,
      10,
      FULL_BUDGET_MS,
    ).catch((thrown: unknown) => thrown)) as Error;
    expect(error.message).not.toContain("youcom-test");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a removed variable that is set to blank", () => {
    process.env[LEGACY_PROVIDER_VARIABLE] = "  ";
    process.env[LEGACY_KEY_VARIABLE] = "";

    expect(() => assertSearchFallbackConfiguration()).not.toThrow();
  });

  it("gives each provider its own key, endpoint and Bearer header", async () => {
    listProviders(undefined);
    process.env[PARALLEL_KEY_VARIABLE] = "parallel-test-value";
    orderParallelFirst();
    mockExchange(documentWith([]));
    mockYoucom([]);

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    // Parallel's three requests carry its key; You.com, with no key of its
    // own, stays on the keyless profile and is never sent Parallel's.
    expect(requestUrls()).toEqual([
      PARALLEL_URL,
      PARALLEL_URL,
      PARALLEL_URL,
      YOUCOM_KEYLESS_URL,
      YOUCOM_KEYLESS_URL,
    ]);
    for (const index of [0, 1, 2]) {
      expect(requestHeaders(index).Authorization).toBe(
        "Bearer parallel-test-value",
      );
    }
    for (const index of [3, 4]) {
      expect(requestHeaders(index).Authorization).toBeUndefined();
    }
  });

  it("switches You.com to its authenticated endpoint with its own key only", async () => {
    listProviders(undefined);
    process.env[YOUCOM_KEY_VARIABLE] = "youcom-test-value";
    orderYoucomFirst();
    mockYoucom([]);
    mockExchange(documentWith([]));

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(requestUrls().slice(0, 2)).toEqual([
      YOUCOM_AUTHENTICATED_URL,
      YOUCOM_AUTHENTICATED_URL,
    ]);
    expect(requestHeaders(0).Authorization).toBe("Bearer youcom-test-value");
    expect(requestHeaders(2).Authorization).toBeUndefined();
  });
});

describe("the cascade", () => {
  beforeEach(() => {
    listProviders(undefined);
  });

  it("tries the providers in the order the shuffle draws", async () => {
    const random = orderYoucomFirst();
    mockYoucom([SERVED_RESULT]);

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(random).toHaveBeenCalled();
    expect(requestUrls()).toEqual([YOUCOM_KEYLESS_URL, YOUCOM_KEYLESS_URL]);

    fetchMock.mockReset();
    random.mockReturnValue(0.99);
    mockExchange(
      documentWith([
        { url: "https://example.com/p", title: "P", excerpts: [EXCERPT] },
      ]),
    );

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(requestUrls()[0]).toBe(PARALLEL_URL);
  });

  it("moves on to the next provider when the first throws", async () => {
    orderParallelFirst();
    fetchMock.mockResolvedValueOnce(createMockResponse("", { status: 500 }));
    mockYoucom([SERVED_RESULT]);

    const results = await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(results).toEqual([
      ["Served", DESCRIPTION, "https://example.com/served"],
    ]);
    expect(getFallbackProviderStats()).toMatchObject({
      parallel: { served: 0, empty: 0, failed: 1 },
      youcom: { served: 1, empty: 0, failed: 0 },
    });
  });

  it("moves on to the next provider when the first answers empty", async () => {
    orderParallelFirst();
    mockExchange(documentWith([]));
    mockYoucom([SERVED_RESULT]);

    const results = await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(results).toHaveLength(1);
    expect(getFallbackProviderStats()).toMatchObject({
      parallel: { served: 0, empty: 1, failed: 0 },
      youcom: { served: 1, empty: 0, failed: 0 },
    });
  });

  it("stops at the first provider that serves", async () => {
    orderYoucomFirst();
    mockYoucom([SERVED_RESULT]);

    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    expect(requestUrls()).not.toContain(PARALLEL_URL);
  });

  it("throws one error naming every provider when all of them fail, without the query", async () => {
    orderParallelFirst();
    fetchMock.mockResolvedValueOnce(createMockResponse("", { status: 500 }));
    fetchMock.mockResolvedValueOnce(createMockResponse("", { status: 503 }));

    const error = (await fetchFallbackTextResults(
      QUERY,
      10,
      FULL_BUDGET_MS,
    ).catch((thrown: unknown) => thrown)) as Error;

    expect(error.message).toBe(
      "Every fallback search provider failed (parallel: The fallback search endpoint did not answer the initialize request (status 500); youcom: The fallback search endpoint did not answer the initialize request (status 503))",
    );
    expect(error.message).not.toContain(QUERY);
  });

  it("returns an empty array when one answered empty and the other failed", async () => {
    orderParallelFirst();
    mockExchange(documentWith([]));
    fetchMock.mockResolvedValueOnce(createMockResponse("", { status: 500 }));

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).resolves.toEqual([]);
  });

  it("returns an empty array when one failed and the other answered empty", async () => {
    orderParallelFirst();
    fetchMock.mockResolvedValueOnce(createMockResponse("", { status: 500 }));
    mockYoucom([]);

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).resolves.toEqual([]);
  });

  it("returns an empty array when every provider answers empty", async () => {
    orderParallelFirst();
    mockExchange(documentWith([]));
    mockYoucom([]);

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).resolves.toEqual([]);
    expect(getFallbackProviderStats()).toMatchObject({
      parallel: { empty: 1 },
      youcom: { empty: 1 },
    });
  });

  it("gives each attempt an equal share of what is left of the budget", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    orderParallelFirst();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    // The first provider spends a second before it fails, so the second one
    // gets what is left, not a share computed at the start.
    fetchMock.mockImplementationOnce(async () => {
      vi.setSystemTime(1_001_000);
      throw new Error("Network failure");
    });
    mockYoucom([SERVED_RESULT]);

    await fetchFallbackTextResults(QUERY, 10, 3_000);

    expect(timeoutSpy.mock.calls).toEqual([[1_500], [2_000]]);
  });

  it("splits the module's own cap when the caller offers more", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    orderParallelFirst();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockExchange(
      documentWith([
        { url: "https://example.com/p", title: "P", excerpts: [EXCERPT] },
      ]),
    );

    await fetchFallbackTextResults(QUERY, 10, 60_000);

    expect(timeoutSpy.mock.calls).toEqual([[7_500]]);
  });

  it("does not start a provider once the budget is spent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    orderParallelFirst();
    fetchMock.mockImplementationOnce(async () => {
      vi.setSystemTime(1_005_000);
      throw new Error("Network failure");
    });

    await expect(fetchFallbackTextResults(QUERY, 10, 3_000)).rejects.toThrow(
      "No fallback search provider served the search (parallel: Network failure; not tried, the time budget ran out: youcom)",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("pausing a rate-limited provider", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // On a whole second, so an HTTP-date Retry-After lands on an exact delta.
    vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 0, 0));
  });

  async function hitRateLimit(headers: Record<string, string> = {}) {
    fetchMock.mockResolvedValueOnce(rateLimited(headers));
    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("rate-limited the request (status 429)");
  }

  it("pauses for the seconds Retry-After asks, skips without a request, and tries again after", async () => {
    await hitRateLimit({ "retry-after": "120" });
    expect(getFallbackProviderStats().parallel).toMatchObject({
      failed: 1,
      rateLimited: 1,
      pausedForMs: 120_000,
    });

    fetchMock.mockClear();
    vi.setSystemTime(Date.now() + 119_000);
    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("No fallback search provider could be tried");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getFallbackProviderStats().parallel).toMatchObject({
      skippedWhilePaused: 1,
      pausedForMs: 1_000,
    });

    vi.setSystemTime(Date.now() + 1_000);
    mockExchange(
      documentWith([
        { url: "https://example.com/p", title: "P", excerpts: [EXCERPT] },
      ]),
    );
    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).resolves.toHaveLength(1);
    expect(getFallbackProviderStats().parallel.pausedForMs).toBe(0);
  });

  it("reads an HTTP-date Retry-After on the tool call", async () => {
    fetchMock.mockResolvedValueOnce(
      createMockResponse(INITIALIZE_REPLY, {
        headers: { "mcp-session-id": SESSION_ID },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      createMockResponse(NOTIFICATION_ACCEPTED, { status: 202 }),
    );
    const cancel = vi.fn(async () => undefined);
    fetchMock.mockResolvedValueOnce(
      createMockResponse("", {
        status: 429,
        headers: {
          "retry-after": new Date(Date.now() + 300_000).toUTCString(),
        },
        unreadBody: { cancel },
      }),
    );

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("status 429");

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(getFallbackProviderStats().parallel.pausedForMs).toBe(300_000);
  });

  it("pauses for a minute when Retry-After is missing or unreadable", async () => {
    await hitRateLimit();
    expect(getFallbackProviderStats().parallel.pausedForMs).toBe(60_000);

    vi.setSystemTime(Date.now() + 60_000);
    await hitRateLimit({ "retry-after": "soon" });
    expect(getFallbackProviderStats().parallel.pausedForMs).toBe(60_000);
  });

  it("pauses for a minute when Retry-After is a string Date.parse would read as a past date", async () => {
    for (const value of ["1.5", "-1", "abc 5"]) {
      await hitRateLimit({ "retry-after": value });
      expect(getFallbackProviderStats().parallel.pausedForMs).toBe(60_000);
      vi.setSystemTime(Date.now() + 60_000);
    }
  });

  it("clamps a past HTTP-date and gives an obsolete date format the default", async () => {
    await hitRateLimit({
      "retry-after": new Date(Date.now() - 60_000).toUTCString(),
    });
    expect(getFallbackProviderStats().parallel.pausedForMs).toBe(1_000);

    vi.setSystemTime(Date.now() + 1_000);
    await hitRateLimit({ "retry-after": "Thursday, 01-Jan-26 12:05:00 GMT" });
    expect(getFallbackProviderStats().parallel.pausedForMs).toBe(60_000);
  });

  it("pauses on a 429 to the initialized notification and discards its body", async () => {
    fetchMock.mockResolvedValueOnce(
      createMockResponse(INITIALIZE_REPLY, {
        headers: { "mcp-session-id": SESSION_ID },
      }),
    );
    const cancel = vi.fn(async () => undefined);
    fetchMock.mockResolvedValueOnce(
      createMockResponse("", {
        status: 429,
        headers: { "retry-after": "45" },
        unreadBody: { cancel },
      }),
    );

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("status 429");

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(getFallbackProviderStats().parallel).toMatchObject({
      rateLimited: 1,
      pausedForMs: 45_000,
    });
  });

  it("skips a provider that a concurrent search paused while this one was waiting", async () => {
    listProviders(undefined);
    orderParallelFirst();
    // Parallel's attempt is still in flight when another search, pinned to
    // You.com, gets a 429 there and pauses it.
    fetchMock.mockImplementationOnce(async () => {
      listProviders("youcom");
      await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS).catch(
        () => undefined,
      );
      throw new Error("Network failure");
    });
    fetchMock.mockResolvedValueOnce(rateLimited({ "retry-after": "3600" }));

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow(
      "Every fallback search provider failed (parallel: Network failure)",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getFallbackProviderStats().youcom).toMatchObject({
      rateLimited: 1,
      skippedWhilePaused: 1,
      pausedForMs: 3_600_000,
    });
  });

  it("never shortens a longer pause that a concurrent search set", async () => {
    // The first search's request is in flight when a second one gets a 429
    // asking for an hour; the first then gets its own 429 asking for a second.
    fetchMock.mockImplementationOnce(async () => {
      await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS).catch(
        () => undefined,
      );
      return rateLimited({ "retry-after": "1" });
    });
    fetchMock.mockResolvedValueOnce(rateLimited({ "retry-after": "3600" }));

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("status 429");

    expect(getFallbackProviderStats().parallel.pausedForMs).toBe(3_600_000);
  });

  it("splits the budget only among the providers that are not paused", async () => {
    listProviders("youcom");
    await hitRateLimit();

    listProviders(undefined);
    orderParallelFirst();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockExchange(
      documentWith([
        { url: "https://example.com/p", title: "P", excerpts: [EXCERPT] },
      ]),
    );

    await fetchFallbackTextResults(QUERY, 10, 3_000);

    expect(timeoutSpy.mock.calls).toEqual([[3_000]]);
  });

  it("clamps the pause to an hour at most and a second at least", async () => {
    await hitRateLimit({ "retry-after": "86400" });
    expect(getFallbackProviderStats().parallel.pausedForMs).toBe(3_600_000);

    vi.setSystemTime(Date.now() + 3_600_000);
    await hitRateLimit({ "retry-after": "0" });
    expect(getFallbackProviderStats().parallel.pausedForMs).toBe(1_000);
  });

  it("skips only the paused provider and goes straight to the next", async () => {
    listProviders(undefined);
    orderParallelFirst();
    fetchMock.mockResolvedValueOnce(rateLimited({ "retry-after": "30" }));
    mockYoucom([SERVED_RESULT]);
    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    fetchMock.mockClear();
    mockYoucom([SERVED_RESULT]);
    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).resolves.toHaveLength(1);

    expect(requestUrls()).toEqual([YOUCOM_KEYLESS_URL, YOUCOM_KEYLESS_URL]);
    expect(getFallbackProviderStats()).toMatchObject({
      parallel: { failed: 1, rateLimited: 1, skippedWhilePaused: 1 },
      youcom: { served: 2 },
    });
  });

  it("does not count a paused provider as skipped once the budget is spent", async () => {
    listProviders(undefined);
    const random = orderYoucomFirst();
    fetchMock.mockResolvedValueOnce(rateLimited({ "retry-after": "600" }));
    mockExchange(
      documentWith([
        { url: "https://example.com/p", title: "P", excerpts: [EXCERPT] },
      ]),
    );
    await fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS);

    random.mockReturnValue(0.99);
    fetchMock.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + FULL_BUDGET_MS);
      throw new Error("Network failure");
    });

    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("not tried, the time budget ran out: youcom");
    expect(getFallbackProviderStats().youcom.skippedWhilePaused).toBe(0);
  });

  it("throws without a request when every provider is paused", async () => {
    listProviders(undefined);
    orderParallelFirst();
    fetchMock.mockResolvedValueOnce(rateLimited());
    fetchMock.mockResolvedValueOnce(rateLimited());
    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("Every fallback search provider failed");

    fetchMock.mockClear();
    await expect(
      fetchFallbackTextResults(QUERY, 10, FULL_BUDGET_MS),
    ).rejects.toThrow("No fallback search provider could be tried");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getFallbackProviderStats", () => {
  it("starts every built-in provider at zero", () => {
    const zero = {
      served: 0,
      empty: 0,
      failed: 0,
      rateLimited: 0,
      skippedWhilePaused: 0,
      pausedForMs: 0,
    };
    expect(getFallbackProviderStats()).toEqual({
      parallel: zero,
      youcom: zero,
    });
  });
});
