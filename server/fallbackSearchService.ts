import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import debug from "debug";
import { shuffle } from "../shared/shuffle.ts";
import { rememberSearchExcerpts } from "./searchExcerptStore.ts";
import { isOpenableUrl } from "./utils/openableUrl.ts";

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
// The most results one Keenable search returns; it refuses a larger count.
const KEENABLE_MAX_RESULTS = 50;

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

interface YoucomWebResult {
  url?: string;
  title?: string | null;
  description?: string | null;
  contents?: { highlights?: string[] } | null;
}

interface YoucomSearchDocument {
  results?: { web?: YoucomWebResult[] };
}

interface KeenableSearchResult {
  url?: string;
  title?: string | null;
  snippet?: string | null;
}

interface KeenableSearchDocument {
  results?: KeenableSearchResult[];
}

type TextualResult = [title: string, content: string, url: string];

type ProviderName = "parallel" | "youcom" | "keenable";

interface MappedResults {
  results: TextualResult[];
  /** The provider's longer text per result URL, kept for `/page-content`. */
  pageTexts?: Map<string, string>;
}

interface FallbackProvider {
  name: ProviderName;
  apiKeyVariable: string;
  /**
   * Left out of the default list: tried only when SEARCH_FALLBACK_PROVIDERS
   * names it or its key is set, so adding it changes nothing for an instance
   * that already runs the fallback.
   */
  optIn?: boolean;
  endpointUrl: (apiKey: string) => string;
  /** The headers that carry the key, and any the provider needs on every request. Bearer when absent. */
  headers?: (apiKey: string) => Record<string, string>;
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
  {
    name: "keenable",
    apiKeyVariable: "SEARCH_FALLBACK_KEENABLE_API_KEY",
    optIn: true,
    endpointUrl: (apiKey) =>
      apiKey
        ? "https://api.keenable.ai/mcp"
        : "https://api.keenable.ai/mcp-public",
    // Keenable reads a key from X-API-Key; a Bearer token there is taken for
    // an OAuth sign-in and refused. The app name identifies the caller on the
    // keyless endpoint.
    headers: (apiKey) => ({
      "X-Keenable-Title": "MiniSearch",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    }),
    // `output_format: json` returns the raw search response instead of the
    // readable text the tool sends by default. Cards (prices, rates) carry
    // URLs that expire after a day, so they are left out.
    toolCall: (query, limit) => ({
      name: "search_web_pages",
      arguments: {
        query,
        max_results: Math.min(limit, KEENABLE_MAX_RESULTS),
        output_format: "json",
        disable_cards: true,
      },
    }),
    mapResults: (document, limit) =>
      mapKeenableResults(document as KeenableSearchDocument, limit),
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

/** Read at call time so tests can toggle it. */
export function isSearchFallbackEnabled(): boolean {
  const value = (process.env.SEARCH_FALLBACK_ENABLED ?? "")
    .trim()
    .toLowerCase();
  return value === "true" || value === "1";
}

/**
 * Meant for server start, so a bad value stops the server instead of failing
 * every search that reaches the fallback.
 */
export function assertSearchFallbackConfiguration(): void {
  readConfiguredProviders();
}

/**
 * Returns a fresh array the caller may reorder. The listed order carries no
 * meaning, since every call shuffles it. Read at call time so tests can
 * switch it.
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

  // undici quotes an invalid header value in full in its error, so a key with
  // a line break inside it would reach the log as `Bearer <key>`. Refused
  // here, by variable name only, so it fails at start instead.
  const keyWithControlCharacter = PROVIDERS.find(({ apiKeyVariable }) =>
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
    /[\u0000-\u001f\u007f]/.test((process.env[apiKeyVariable] ?? "").trim()),
  );
  if (keyWithControlCharacter) {
    throw new Error(
      `${keyWithControlCharacter.apiKeyVariable} contains a control character; set it to the key alone.`,
    );
  }

  const value = process.env.SEARCH_FALLBACK_PROVIDERS ?? "";
  if (value.trim() === "") {
    return PROVIDERS.filter(
      ({ optIn, apiKeyVariable }) =>
        !optIn || (process.env[apiKeyVariable] ?? "").trim() !== "",
    );
  }

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
  const notTried: string[] = [];
  let answered = false;

  for (const [index, provider] of candidates.entries()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      notTried.push(...candidates.slice(index).map(({ name }) => name));
      break;
    }

    // Checked again before every attempt, not once up front: another search
    // can pause a provider while this one waits on an earlier attempt, and a
    // paused provider must not get a new exchange. An exchange already under
    // way runs to its end, which costs at most two more requests.
    if (isPaused(provider.name)) {
      countFor(provider.name).skippedWhilePaused++;
      printMessage(`Fallback provider ${provider.name} skipped while paused.`);
      continue;
    }
    const eligibleCount = candidates
      .slice(index)
      .filter((candidate) => !isPaused(candidate.name)).length;
    const attemptMs = Math.ceil(remainingMs / eligibleCount);

    try {
      const { results, pageTexts } = await searchWithProvider(
        provider,
        query,
        limit,
        AbortSignal.timeout(attemptMs),
      );
      answered = true;
      if (results.length > 0) {
        countFor(provider.name).served++;
        printMessage(`Fallback search served by ${provider.name}.`);
        for (const [url, text] of pageTexts ?? []) {
          rememberSearchExcerpts(query, url, text);
        }
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
    // A provider the budget ran out before is named as such, so the log does
    // not read as if it had been asked and failed.
    throw new Error(
      notTried.length > 0
        ? `No fallback search provider served the search (${failures.join("; ")}; not tried, the time budget ran out: ${notTried.join(", ")})`
        : `Every fallback search provider failed (${failures.join("; ")})`,
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

// RFC 9110's IMF-fixdate. Date.parse alone is too lenient: V8 turns strings
// such as "1.5" or "-1" into dates in 2001, which would clamp to the minimum
// pause instead of the default an unreadable value gets. The two obsolete
// HTTP-date formats also fall to the default, which is the cautious side.
const IMF_FIXDATE =
  /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

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
 * Checked on every request of the exchange, since any of them can be the one
 * the limit lands on.
 */
async function rejectIfRateLimited(response: Response): Promise<void> {
  if (response.status !== 429) return;
  await response.body?.cancel();
  throw new RateLimitedError(response.headers.get("retry-after"));
}

/**
 * The session is optional: with no session id on the initialize reply the
 * endpoint is stateless, so the initialized notification and the session id
 * are skipped, since there is no session to acknowledge.
 */
async function searchWithProvider(
  provider: FallbackProvider,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<MappedResults> {
  const apiKey = (process.env[provider.apiKeyVariable] ?? "").trim();
  const endpointUrl = provider.endpointUrl(apiKey);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(provider.headers
      ? provider.headers(apiKey)
      : apiKey
        ? { Authorization: `Bearer ${apiKey}` }
        : {}),
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

  // The MCP transport spec requires the version header on every request after
  // initialize, with or without a session; only the session id is optional.
  const postInitializeHeaders = {
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
  };

  if (sessionId) {
    // A notification, so there is no reply body to read: the session is only
    // usable once the endpoint has acknowledged it, and `ok` is the whole
    // acknowledgement.
    const initializedResponse = await fetch(endpointUrl, {
      method: "POST",
      headers: { ...headers, ...postInitializeHeaders },
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
    headers: { ...headers, ...postInitializeHeaders },
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
  return provider.mapResults(document, limit);
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

  // The snippet keeps 400 characters of the excerpts; the rest is what the
  // page read would have gone looking for, so it is kept for `/page-content`.
  const pageTexts = new Map<string, string>();
  const results = mapEntries(document.results, limit, (result) => {
    const text = cleanExcerpts(result.excerpts);
    if (text && typeof result.url === "string") pageTexts.set(result.url, text);
    return toSnippet(text);
  });

  return { results, pageTexts };
}

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
  };
}

/**
 * Keenable's snippet is markdown cut from the page for the query, the same
 * kind of text as a Parallel excerpt, so each result is read as a Parallel
 * result with that one excerpt: cleaned the same way, and kept whole for
 * `/page-content`.
 */
function mapKeenableResults(
  document: KeenableSearchDocument,
  limit: number,
): MappedResults {
  if (!Array.isArray(document.results)) return mapParallelResults({}, limit);

  return mapParallelResults(
    {
      results: document.results.map((result) =>
        result && typeof result === "object"
          ? {
              url: result.url,
              title: result.title,
              excerpts:
                typeof result.snippet === "string" ? [result.snippet] : [],
            }
          : result,
      ),
    },
    limit,
  );
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
      !isOpenableUrl(entry.url) ||
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

function buildSnippet(excerpts: string[] | undefined): string {
  return toSnippet(cleanExcerpts(excerpts));
}

/**
 * One kept line per paragraph, separated by blank lines, which is where
 * `splitIntoPassages` cuts when the text is read as page content.
 */
function cleanExcerpts(excerpts: string[] | undefined): string {
  if (!Array.isArray(excerpts) || excerpts.length === 0) return "";

  return excerpts
    .join("\n")
    .split("\n")
    .map(stripMarkdown)
    .filter((line) => line.length >= MIN_SNIPPET_LINE_LENGTH)
    .join("\n\n");
}

function toSnippet(text: string): string {
  return truncateSnippet(text.replace(/\s+/g, " ").trim());
}

/**
 * Cuts at a word boundary: a mid-word stump reads as a rendering bug, and the
 * ellipsis is what tells the reader the sentence was cut, not finished.
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
