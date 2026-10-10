import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import debug from "debug";

const fileName = basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

const MCP_PROTOCOL_VERSION = "2025-06-18";
// Bounds the whole cascade, not each request: a fallback that hangs longer
// than this keeps the 502 the operator already gets from SearXNG waiting for
// a second source that is only there to soften the outage.
const FALLBACK_TIMEOUT_MS = 15_000;
const MAX_SNIPPET_LENGTH = 400;
// Excerpts arrive with navigation crumbs ("Skip to main content", menu items)
// that are sentences of their own; a real excerpt paragraph never runs this
// short, so length is the cheapest way to drop them without a stoplist.
const MIN_SNIPPET_LINE_LENGTH = 40;
// You.com's acceptable use policy can suspend a client that keeps calling
// through 429s, so a provider that sends one is left alone for the time it
// asks for. A missing or unreadable Retry-After gets a minute, and no answer
// may box a provider for longer than an hour or shorter than a second.
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
const MAX_RATE_LIMIT_PAUSE_MS = 3_600_000;
const MIN_RATE_LIMIT_PAUSE_MS = 1_000;

// One per server process: Parallel uses it for free-tier rate limiting and
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

interface ParallelSearchResult {
  url?: string;
  title?: string | null;
  publish_date?: string | null;
  excerpts?: string[];
}

interface ParallelSearchDocument {
  results?: ParallelSearchResult[];
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

type ProviderName = "parallel" | "youcom";

interface MappedResults {
  results: TextualResult[];
  received: number;
}

interface FallbackProvider {
  name: ProviderName;
  apiKeyVariable: string;
  endpointUrl: (apiKey: string) => string;
  toolCall: (
    query: string,
    limit: number,
  ) => { name: string; arguments: Record<string, unknown> };
  mapResults: (document: object, limit: number) => MappedResults;
}

const PROVIDERS: readonly FallbackProvider[] = [
  {
    name: "parallel",
    apiKeyVariable: "SEARCH_FALLBACK_PARALLEL_API_KEY",
    endpointUrl: () => "https://search.parallel.ai/mcp",
    // No `model_name`: this is a search, not a completion, and the tool does
    // not need a client that claims to be a model.
    toolCall: (query) => ({
      name: "web_search",
      arguments: {
        objective: query,
        search_queries: [query],
        session_id: SESSION_ID,
      },
    }),
    mapResults: (document, limit) =>
      mapParallelResults(document as ParallelSearchDocument, limit),
  },
  {
    name: "youcom",
    apiKeyVariable: "SEARCH_FALLBACK_YOUCOM_API_KEY",
    // The free profile needs no key at all, and the key, when present,
    // selects the authenticated endpoint instead.
    endpointUrl: (apiKey) =>
      apiKey
        ? "https://api.you.com/mcp"
        : "https://api.you.com/mcp?profile=free",
    toolCall: (query, limit) => ({
      name: "you-search",
      arguments: { query, count: limit },
    }),
    mapResults: (document, limit) =>
      mapYoucomResults(document as YoucomSearchDocument, limit),
  },
];

const PROVIDER_NAMES = PROVIDERS.map((provider) => provider.name);

// Each removed variable and what replaced it: an operator upgrading with the
// old names set would otherwise lose the key without a word and fall back to
// the keyless tiers.
const REMOVED_VARIABLES: readonly [variable: string, replacement: string][] = [
  ["SEARCH_FALLBACK_PROVIDER", "SEARCH_FALLBACK_PROVIDERS"],
  [
    "SEARCH_FALLBACK_API_KEY",
    "SEARCH_FALLBACK_PARALLEL_API_KEY or SEARCH_FALLBACK_YOUCOM_API_KEY",
  ],
];

interface ProviderCounters {
  served: number;
  empty: number;
  failed: number;
  rateLimited: number;
  skippedWhilePaused: number;
}

const providerCounters = new Map<ProviderName, ProviderCounters>(
  PROVIDER_NAMES.map((name) => [
    name,
    { served: 0, empty: 0, failed: 0, rateLimited: 0, skippedWhilePaused: 0 },
  ]),
);

const pausedUntil = new Map<ProviderName, number>();

class RateLimitedError extends Error {
  readonly retryAfter: string | null;

  constructor(retryAfter: string | null) {
    super("The fallback search endpoint rate-limited the request (status 429)");
    this.retryAfter = retryAfter;
  }
}

/**
 * Whether the operator opted into the second text-search source. Off unless
 * `SEARCH_FALLBACK_ENABLED` is `true` or `1`, read at call time so tests can
 * toggle it.
 */
export function isSearchFallbackEnabled(): boolean {
  const value = (process.env.SEARCH_FALLBACK_ENABLED ?? "")
    .trim()
    .toLowerCase();
  return value === "true" || value === "1";
}

/**
 * Checks the fallback configuration and throws on the first thing wrong with
 * it: a removed variable that is still set, an unknown provider name, or a
 * provider list with no names in it. Meant for server start, so a bad value
 * stops the server instead of failing every search that reaches the fallback.
 */
export function assertSearchFallbackConfiguration(): void {
  readConfiguredProviders();
}

/**
 * The providers the operator listed in `SEARCH_FALLBACK_PROVIDERS`, or every
 * built-in provider when it is unset or blank, as a fresh array the caller may
 * reorder. The listed order carries no meaning, since every call shuffles it.
 * Read at call time so tests can switch it.
 */
function readConfiguredProviders(): FallbackProvider[] {
  const stillSet = REMOVED_VARIABLES.filter(
    ([variable]) => (process.env[variable] ?? "").trim() !== "",
  );
  if (stillSet.length > 0) {
    throw new Error(
      stillSet
        .map(
          ([variable, replacement]) =>
            `${variable} is no longer read; set ${replacement} instead.`,
        )
        .join(" "),
    );
  }

  const value = process.env.SEARCH_FALLBACK_PROVIDERS ?? "";
  if (value.trim() === "") return [...PROVIDERS];

  const names = value
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");
  if (names.length === 0) {
    throw new Error(
      `SEARCH_FALLBACK_PROVIDERS lists no provider; valid names: ${PROVIDER_NAMES.join(", ")}.`,
    );
  }

  const unknown = names.filter(
    (name) => !PROVIDER_NAMES.includes(name as ProviderName),
  );
  if (unknown.length > 0) {
    throw new Error(
      `SEARCH_FALLBACK_PROVIDERS has unknown provider names: ${unknown.join(", ")}; valid names: ${PROVIDER_NAMES.join(", ")}.`,
    );
  }

  return PROVIDERS.filter((provider) => names.includes(provider.name));
}

/**
 * Per-provider counters since the last restart, for `/status`, and how much
 * longer each provider stays paused after a 429 (0 when it is not paused).
 * `rateLimited` is a subset of `failed`. Provider names are configured
 * infrastructure rather than anything a search supplied, so they are safe to
 * publish.
 */
export function getFallbackProviderStats(): Record<
  string,
  ProviderCounters & { pausedForMs: number }
> {
  const now = Date.now();
  return Object.fromEntries(
    PROVIDER_NAMES.map((name) => [
      name,
      {
        ...(providerCounters.get(name) as ProviderCounters),
        pausedForMs: Math.max(0, (pausedUntil.get(name) ?? 0) - now),
      },
    ]),
  );
}

/**
 * Runs a text search against the fallback providers when SearXNG has already
 * failed, and returns the same `[title, snippet, url]` tuples the SearXNG path
 * produces, so the caller can rank and render them unchanged.
 *
 * Every configured provider is a candidate, tried one at a time in a fresh
 * random order on each call, so the load spreads across them and no single
 * provider's outage or rate limit decides the outcome. A provider paused by
 * an earlier 429 is skipped without a request. The first non-empty answer
 * wins; an empty answer or an error moves on to the next provider.
 *
 * `timeoutMs` is the time the caller can still afford, measured from its own
 * start: the cascade is bounded by this and by the module's own cap, whichever
 * is shorter, and each attempt gets an equal share of what is left, so a
 * provider that hangs cannot spend the time the next one needs.
 *
 * Returns an empty array when at least one provider answered and none had
 * anything usable. Throws when every provider that was tried failed, with
 * each one's name and error, or when none could be tried at all: the caller
 * has to decide between a degraded answer and the 502 it would have sent
 * anyway, and it has to be able to count the decision.
 */
export async function fetchFallbackTextResults(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<TextualResult[]> {
  const deadline = Date.now() + Math.min(FALLBACK_TIMEOUT_MS, timeoutMs);
  const candidates = shuffle(readConfiguredProviders());

  const failures: string[] = [];
  let answered = false;

  for (const [index, provider] of candidates.entries()) {
    // Checked again before every attempt, not once up front: another search
    // can pause a provider while this one waits on an earlier attempt, and a
    // paused provider must not get a request.
    if (isPaused(provider.name)) {
      countFor(provider.name).skippedWhilePaused++;
      printMessage(`Fallback provider ${provider.name} skipped while paused.`);
      continue;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const eligibleCount = candidates
      .slice(index)
      .filter((candidate) => !isPaused(candidate.name)).length;
    const attemptMs = Math.ceil(remainingMs / eligibleCount);

    try {
      const results = await searchWithProvider(
        provider,
        query,
        limit,
        AbortSignal.timeout(attemptMs),
      );
      answered = true;
      if (results.length > 0) {
        countFor(provider.name).served++;
        printMessage(`Fallback search served by ${provider.name}.`);
        return results;
      }
      countFor(provider.name).empty++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      countFor(provider.name).failed++;
      if (error instanceof RateLimitedError) {
        countFor(provider.name).rateLimited++;
        const pauseMs = rateLimitPauseMs(error.retryAfter);
        // Never shortens a pause already in place: a concurrent search may
        // have been told to stay away for longer.
        pausedUntil.set(
          provider.name,
          Math.max(pausedUntil.get(provider.name) ?? 0, Date.now() + pauseMs),
        );
        printMessage(
          `Fallback provider ${provider.name} paused for ${pauseMs} ms after a 429.`,
        );
      }
      printMessage(`Fallback provider ${provider.name} failed: ${message}`);
      failures.push(`${provider.name}: ${message}`);
    }
  }

  if (answered) return [];
  if (failures.length > 0) {
    throw new Error(
      `Every fallback search provider failed (${failures.join("; ")})`,
    );
  }
  throw new Error(
    "No fallback search provider could be tried: all are paused after a rate limit, or the time budget ran out",
  );
}

function isPaused(name: ProviderName): boolean {
  return (pausedUntil.get(name) ?? 0) > Date.now();
}

function countFor(name: ProviderName): ProviderCounters {
  return providerCounters.get(name) as ProviderCounters;
}

function shuffle<Item>(items: Item[]): Item[] {
  for (let index = items.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

// RFC 9110's IMF-fixdate. Date.parse alone is too lenient: V8 turns strings
// such as "1.5" or "-1" into dates in 2001, which would clamp to the minimum
// pause instead of the default an unreadable value gets. The two obsolete
// HTTP-date formats also fall to the default, which is the cautious side.
const IMF_FIXDATE =
  /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Reads Retry-After as delta-seconds or an IMF-fixdate HTTP-date, and clamps
 * the result to the bounds the module allows.
 */
function rateLimitPauseMs(retryAfter: string | null): number {
  const value = retryAfter?.trim() ?? "";
  let pauseMs = DEFAULT_RATE_LIMIT_PAUSE_MS;
  if (/^\d+$/.test(value)) {
    pauseMs = Number(value) * 1000;
  } else if (IMF_FIXDATE.test(value)) {
    const retryAt = Date.parse(value);
    if (!Number.isNaN(retryAt)) pauseMs = retryAt - Date.now();
  }
  return Math.min(
    MAX_RATE_LIMIT_PAUSE_MS,
    Math.max(MIN_RATE_LIMIT_PAUSE_MS, pauseMs),
  );
}

/**
 * Throws the error the cascade pauses a provider on. Checked on every request
 * of the exchange, since any of them can be the one the limit lands on.
 */
async function rejectIfRateLimited(response: Response): Promise<void> {
  if (response.status !== 429) return;
  await response.body?.cancel();
  throw new RateLimitedError(response.headers.get("retry-after"));
}

/**
 * Runs one provider's MCP exchange: initialize, the initialized notification
 * when the endpoint opened a session, and the tool call. The session is
 * optional: with no session id on the initialize reply the endpoint is
 * stateless, so the notification and the session headers are skipped, since
 * there is no session to acknowledge.
 */
async function searchWithProvider(
  provider: FallbackProvider,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<TextualResult[]> {
  const apiKey = (process.env[provider.apiKeyVariable] ?? "").trim();
  const endpointUrl = provider.endpointUrl(apiKey);

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
  await rejectIfRateLimited(initializeResponse);
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
    await rejectIfRateLimited(initializedResponse);
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
      params: provider.toolCall(query, limit),
    }),
    signal,
  });
  await rejectIfRateLimited(callResponse);
  if (!callResponse.ok) {
    await callResponse.body?.cancel();
    throw new Error(
      `The fallback search tool call failed with status ${callResponse.status}`,
    );
  }

  const document = await readSearchDocument<object>(callResponse, 2);
  const { results, received } = provider.mapResults(document, limit);
  printMessage(
    `Fallback search usable text results from ${provider.name}: ${results.length} of ${received}.`,
  );
  return results;
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

function mapParallelResults(
  document: ParallelSearchDocument,
  limit: number,
): MappedResults {
  if (!Array.isArray(document.results)) {
    throw new Error(
      "The fallback search endpoint returned a document without a results array",
    );
  }

  return {
    results: mapEntries(document.results, limit, (result) =>
      buildSnippet(result.excerpts),
    ),
    received: document.results.length,
  };
}

/**
 * Maps You.com's `results.web` array by the same rules the Parallel path
 * follows, so the tuples reach ranking and rendering unchanged.
 */
function mapYoucomResults(
  document: YoucomSearchDocument,
  limit: number,
): MappedResults {
  if (!Array.isArray(document.results?.web)) {
    throw new Error(
      "The fallback search endpoint returned a document without a web results array",
    );
  }

  return {
    results: mapEntries(document.results.web, limit, buildYoucomSnippet),
    received: document.results.web.length,
  };
}

function mapEntries<Entry extends { url?: string; title?: string | null }>(
  entries: Entry[],
  limit: number,
  snippetOf: (entry: Entry) => string,
): TextualResult[] {
  const seenUrls = new Set<string>();
  const mapped: TextualResult[] = [];

  for (const entry of entries) {
    if (mapped.length >= limit) break;
    // Upstream data, so one malformed entry must not fail the whole search: a
    // result that is not an object, or whose url or title is not a string, is
    // skipped rather than left to throw on `.trim()`.
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.url !== "string" ||
      !entry.url ||
      seenUrls.has(entry.url)
    ) {
      continue;
    }

    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title) continue;

    const snippet = snippetOf(entry);
    if (!snippet) continue;

    seenUrls.add(entry.url);
    mapped.push([title, snippet, entry.url]);
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
