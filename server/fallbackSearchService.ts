import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import debug from "debug";

const fileName = basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

const PARALLEL_ENDPOINT_URL = "https://search.parallel.ai/mcp";
// You.com answers the same JSON-RPC exchange. The free profile needs no key at
// all, and the key, when present, selects the authenticated endpoint instead.
const YOUCOM_ENDPOINT_URL_KEYLESS = "https://api.you.com/mcp?profile=free";
const YOUCOM_ENDPOINT_URL_AUTHENTICATED = "https://api.you.com/mcp";
const MCP_PROTOCOL_VERSION = "2025-06-18";
// Bounds the whole fallback exchange, not each request: a fallback that
// hangs longer than this keeps the 502 the operator already gets from SearXNG
// waiting for a second source that is only there to soften the outage.
const FALLBACK_TIMEOUT_MS = 15_000;
const MAX_SNIPPET_LENGTH = 400;
// Excerpts arrive with navigation crumbs ("Skip to main content", menu items)
// that are sentences of their own; a real excerpt paragraph never runs this
// short, so length is the cheapest way to drop them without a stoplist.
const MIN_SNIPPET_LINE_LENGTH = 40;

// One per server process: the endpoint uses it for free-tier rate limiting and
// one MiniSearch instance is one client, so a fresh one per request would shed
// the rate limit instead of sharing it.
const SESSION_ID = randomUUID();

interface JsonRpcMessage {
  id?: number;
  error?: { code?: unknown };
  result?: {
    isError?: boolean;
    content?: { type?: string; text?: string }[];
  };
}

interface FallbackSearchResult {
  url?: string;
  title?: string | null;
  publish_date?: string | null;
  excerpts?: string[];
}

interface FallbackSearchDocument {
  results?: FallbackSearchResult[];
}

// You.com's tool output: the web results sit one level deeper, under
// `results.web`, and each result carries a plain description plus, when the
// query matched the page, query-relevant highlights.
interface YoucomWebResult {
  url?: string;
  title?: string | null;
  description?: string | null;
  contents?: { highlights?: string[] } | null;
}

interface YoucomSearchDocument {
  results?: { web?: YoucomWebResult[] };
}

type TextualResult = [title: string, content: string, url: string];

/**
 * Whether the operator chose You.com as the second text-search source. Off
 * unless `SEARCH_FALLBACK_PROVIDER` is `youcom`, read at call time so tests
 * can switch it, and any other value keeps Parallel, the default.
 */
function isYoucomFallbackProvider(): boolean {
  const value = process.env.SEARCH_FALLBACK_PROVIDER?.trim().toLowerCase();
  return value === "youcom";
}

/**
 * Whether the operator opted into the second text-search source. Off unless
 * `SEARCH_FALLBACK_ENABLED` is `true` or `1`, read at call time so tests can
 * toggle it.
 */
export function isSearchFallbackEnabled(): boolean {
  const value = process.env.SEARCH_FALLBACK_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/**
 * Runs a text search against the fallback endpoint when SearXNG has already
 * failed, and returns the same `[title, snippet, url]` tuples the SearXNG path
 * produces, so the caller can rank and render them unchanged.
 *
 * `timeoutMs` is the time the caller can still afford, measured from its own
 * start: the exchange is bounded by this and by the module's own cap, whichever
 * is shorter, so a search that has already spent most of its budget on SearXNG
 * cannot hang on here past the point where the client has given up.
 *
 * The source is Parallel by default, or You.com when
 * `SEARCH_FALLBACK_PROVIDER` is `youcom`; both answer the same JSON-RPC
 * exchange, so the budgets, the error discipline and the mapped tuples are the
 * same either way.
 *
 * Throws on any failure rather than returning what it managed to collect: the
 * caller has to decide between a degraded answer and the 502 it would have sent
 * anyway, and it has to be able to count the decision. An empty array is the
 * one non-throwing outcome that means the endpoint answered and nothing usable
 * came back.
 */
export async function fetchFallbackTextResults(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<TextualResult[]> {
  return isYoucomFallbackProvider()
    ? fetchYoucomTextResults(query, limit, timeoutMs)
    : fetchParallelTextResults(query, limit, timeoutMs);
}

async function fetchParallelTextResults(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<TextualResult[]> {
  const apiKey = process.env.SEARCH_FALLBACK_API_KEY?.trim();
  const signal = AbortSignal.timeout(Math.min(FALLBACK_TIMEOUT_MS, timeoutMs));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const initializeResponse = await fetch(PARALLEL_ENDPOINT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "MiniSearch", version: "1" },
      },
    }),
    signal,
  });
  const sessionId = initializeResponse.headers.get("mcp-session-id");
  // An unread body keeps undici's socket out of the pool until it is GC'd, so
  // both outcomes have to discard it before they part ways with the response.
  await initializeResponse.body?.cancel();
  if (!initializeResponse.ok || !sessionId) {
    throw new Error(
      `The fallback search endpoint did not open a session (status ${initializeResponse.status})`,
    );
  }

  const sessionHeaders = {
    "Mcp-Session-Id": sessionId,
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };

  // A notification, so there is no reply body to read: the session is only
  // usable once the endpoint has acknowledged it, and `ok` is the whole
  // acknowledgement.
  const initializedResponse = await fetch(PARALLEL_ENDPOINT_URL, {
    method: "POST",
    headers: { ...headers, ...sessionHeaders },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    signal,
  });
  await initializedResponse.body?.cancel();
  if (!initializedResponse.ok) {
    throw new Error(
      `The fallback search endpoint rejected the initialized notification (status ${initializedResponse.status})`,
    );
  }

  const callResponse = await fetch(PARALLEL_ENDPOINT_URL, {
    method: "POST",
    headers: { ...headers, ...sessionHeaders },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "web_search",
        // No `model_name`: this is a search, not a completion, and the tool
        // does not need a client that claims to be a model.
        arguments: {
          objective: query,
          search_queries: [query],
          session_id: SESSION_ID,
        },
      },
    }),
    signal,
  });
  if (!callResponse.ok) {
    await callResponse.body?.cancel();
    throw new Error(
      `The fallback search tool call failed with status ${callResponse.status}`,
    );
  }

  const document = await readSearchDocument<FallbackSearchDocument>(
    callResponse,
    2,
  );
  const textualResults = mapResults(document, limit);
  printMessage(
    `Fallback search usable text results: ${textualResults.length} of ${document.results?.length ?? 0}.`,
  );
  return textualResults;
}

/**
 * Runs the text search against You.com's MCP endpoint. You.com keeps the
 * session optional: with no session id on the initialize reply the endpoint is
 * stateless, so the initialized notification and the session headers are
 * skipped — there is no session to acknowledge — and the tool call goes out on
 * its own. A future You.com that does open sessions is handled by the same
 * branch the Parallel path takes.
 */
async function fetchYoucomTextResults(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<TextualResult[]> {
  const apiKey = process.env.SEARCH_FALLBACK_API_KEY?.trim();
  const signal = AbortSignal.timeout(Math.min(FALLBACK_TIMEOUT_MS, timeoutMs));
  const endpointUrl = apiKey
    ? YOUCOM_ENDPOINT_URL_AUTHENTICATED
    : YOUCOM_ENDPOINT_URL_KEYLESS;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const initializeResponse = await fetch(endpointUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "MiniSearch", version: "1" },
      },
    }),
    signal,
  });
  const sessionId = initializeResponse.headers.get("mcp-session-id");
  // An unread body keeps undici's socket out of the pool until it is GC'd, so
  // both outcomes have to discard it before they part ways with the response.
  await initializeResponse.body?.cancel();
  if (!initializeResponse.ok) {
    throw new Error(
      `The fallback search endpoint did not answer the initialize request (status ${initializeResponse.status})`,
    );
  }

  const sessionHeaders = sessionId
    ? {
        "Mcp-Session-Id": sessionId,
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      }
    : undefined;

  if (sessionId) {
    // A notification, so there is no reply body to read: the session is only
    // usable once the endpoint has acknowledged it, and `ok` is the whole
    // acknowledgement.
    const initializedResponse = await fetch(endpointUrl, {
      method: "POST",
      headers: { ...headers, ...sessionHeaders },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
      signal,
    });
    await initializedResponse.body?.cancel();
    if (!initializedResponse.ok) {
      throw new Error(
        `The fallback search endpoint rejected the initialized notification (status ${initializedResponse.status})`,
      );
    }
  }

  const callResponse = await fetch(endpointUrl, {
    method: "POST",
    headers: { ...headers, ...sessionHeaders },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "you-search",
        arguments: {
          query,
          count: limit,
        },
      },
    }),
    signal,
  });
  if (!callResponse.ok) {
    await callResponse.body?.cancel();
    throw new Error(
      `The fallback search tool call failed with status ${callResponse.status}`,
    );
  }

  const document = await readSearchDocument<YoucomSearchDocument>(
    callResponse,
    2,
  );
  const textualResults = mapYoucomResults(document, limit);
  printMessage(
    `Fallback search usable text results: ${textualResults.length} of ${document.results?.web?.length ?? 0}.`,
  );
  return textualResults;
}

/**
 * Reads the JSON-RPC reply to `requestId`. The endpoint answers either one
 * JSON message or an SSE stream of them, and which of them belongs to this
 * request is decided by the id, not by position: the stream can carry
 * notifications the client never asked for.
 */
async function readSearchDocument<SearchDocument>(
  response: Response,
  requestId: number,
): Promise<SearchDocument> {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  const messages = contentType.includes("text/event-stream")
    ? parseEventStream(body)
    : parseJsonBody(body);

  const reply = messages.find((message) => message.id === requestId);
  if (!reply) {
    throw new Error(
      `The fallback search endpoint sent no reply to request ${requestId}`,
    );
  }

  // Only a numeric code: an upstream error message is free-form text from a
  // third party, and a non-numeric code is upstream data just the same, so
  // neither may reach the log or a thrown error.
  if (reply.error) {
    throw new Error(
      typeof reply.error.code === "number"
        ? `The fallback search endpoint returned a JSON-RPC error (code ${reply.error.code})`
        : "The fallback search endpoint returned a JSON-RPC error",
    );
  }

  if (reply.result?.isError) {
    throw new Error(
      "The fallback search endpoint reported the search as failed",
    );
  }

  const payload = (reply.result?.content ?? [])
    .flatMap((item) =>
      item.type === "text" && typeof item.text === "string" ? [item.text] : [],
    )
    .join("\n");

  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as SearchDocument;
  } catch {
    throw new Error(
      "The fallback search endpoint returned tool output that is not JSON",
    );
  }
}

function parseJsonBody(body: string): JsonRpcMessage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A raw SyntaxError quotes the offending snippet, which would carry the
    // upstream response into the thrown error and from there into the log.
    throw new Error(
      "The fallback search endpoint sent a reply that is not JSON",
    );
  }

  if (Array.isArray(parsed)) return parsed as JsonRpcMessage[];
  return [parsed as JsonRpcMessage];
}

/**
 * SSE blocks are separated by a blank line and each `data:` line holds a
 * fragment of one JSON message. A block that is not JSON is a keep-alive or an
 * event this client did not ask for, so it is skipped rather than failing a
 * reply that may be perfectly good.
 */
function parseEventStream(body: string): JsonRpcMessage[] {
  return body.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");

    if (!data) return [];

    try {
      const parsed: unknown = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed as JsonRpcMessage[];
      return [parsed as JsonRpcMessage];
    } catch {
      return [];
    }
  });
}

function mapResults(
  document: FallbackSearchDocument,
  limit: number,
): TextualResult[] {
  if (!Array.isArray(document.results)) {
    throw new Error(
      "The fallback search endpoint returned a document without a results array",
    );
  }

  const seenUrls = new Set<string>();
  const mapped: TextualResult[] = [];

  for (const result of document.results) {
    if (mapped.length >= limit) break;
    // Upstream data, so one malformed entry must not fail the whole search: a
    // result that is not an object, or whose url or title is not a string, is
    // skipped rather than left to throw on `.trim()`.
    if (
      !result ||
      typeof result !== "object" ||
      typeof result.url !== "string" ||
      !result.url ||
      seenUrls.has(result.url)
    ) {
      continue;
    }

    const title = typeof result.title === "string" ? result.title.trim() : "";
    if (!title) continue;

    const snippet = buildSnippet(result.excerpts);
    if (!snippet) continue;

    seenUrls.add(result.url);
    mapped.push([title, snippet, result.url]);
  }

  return mapped;
}

/**
 * Maps You.com's `results.web` array by the same rules the Parallel path
 * follows, so the tuples reach ranking and rendering unchanged.
 */
function mapYoucomResults(
  document: YoucomSearchDocument,
  limit: number,
): TextualResult[] {
  if (!Array.isArray(document.results?.web)) {
    throw new Error(
      "The fallback search endpoint returned a document without a web results array",
    );
  }

  const seenUrls = new Set<string>();
  const mapped: TextualResult[] = [];

  for (const result of document.results.web) {
    if (mapped.length >= limit) break;
    // Upstream data, so one malformed entry must not fail the whole search: a
    // result that is not an object, or whose url or title is not a string, is
    // skipped rather than left to throw on `.trim()`.
    if (
      !result ||
      typeof result !== "object" ||
      typeof result.url !== "string" ||
      !result.url ||
      seenUrls.has(result.url)
    ) {
      continue;
    }

    const title = typeof result.title === "string" ? result.title.trim() : "";
    if (!title) continue;

    const snippet = buildYoucomSnippet(result);
    if (!snippet) continue;

    seenUrls.add(result.url);
    mapped.push([title, snippet, result.url]);
  }

  return mapped;
}

/**
 * You.com returns a plain description for every result, and, when the query
 * matched the page, query-relevant highlights as well. The description is the
 * curated summary, so it is used as-is — it is not passed through the excerpt
 * length filter, which would drop a short but complete sentence — and the
 * highlights take over only when the description is empty, through the same
 * filter the Parallel path applies to its excerpts.
 */
function buildYoucomSnippet(result: YoucomWebResult): string {
  const description =
    typeof result.description === "string"
      ? result.description.replace(/\s+/g, " ").trim()
      : "";
  if (description) return truncateSnippet(description);

  return buildSnippet(result.contents?.highlights);
}

/**
 * Turns the endpoint's markdown excerpts into the plain, single-line snippet
 * the SearXNG path hands to ranking.
 */
function buildSnippet(excerpts: string[] | undefined): string {
  if (!Array.isArray(excerpts) || excerpts.length === 0) return "";

  const snippet = excerpts
    .join("\n")
    .split("\n")
    .map(stripMarkdown)
    .filter((line) => line.length >= MIN_SNIPPET_LINE_LENGTH)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return truncateSnippet(snippet);
}

/**
 * Caps a finished snippet at the length the ranking path expects. Cuts at a
 * word boundary: a mid-word stump reads as a rendering bug, and the ellipsis
 * is what tells the reader the sentence was cut, not finished.
 */
function truncateSnippet(snippet: string): string {
  if (snippet.length <= MAX_SNIPPET_LENGTH) return snippet;

  const cut = snippet.slice(0, MAX_SNIPPET_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}
