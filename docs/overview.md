# MiniSearch Overview

## System Purpose and Design Philosophy

MiniSearch serves as a privacy-preserving search interface with optional AI augmentation. The system prioritizes user privacy by routing all web searches through SearXNG, which aggregates results from multiple search engines without tracking. AI processing can occur entirely client-side in the browser, ensuring no user queries or responses leave the device.

The architecture follows a layered design where search, AI inference, and presentation concerns are separated.

## Core Technologies and Dependencies

MiniSearch integrates multiple technology stacks within a unified deployment container:

### Frontend

- **React** - UI framework
- **React DOM** - DOM rendering
- **Mantine UI** - Component library (`@mantine/core`, `@mantine/hooks`, `@mantine/carousel`)
- **Vite** - Build tool with React plugin
- **TypeScript** - Type safety

### AI & Search

- **@wllama/wllama** - Client-side AI inference (WebGPU-accelerated or CPU via WebAssembly)
- **AI SDK** - AI integration layer
- **@ai-sdk/openai-compatible** - Unified AI interface

### Data & State

- **Dexie** - IndexedDB management
- **create-pubsub** - State management (avoid React Context)
- **usePubSub** - Component subscriptions

## Application Entry Points

The application has three primary entry points:

1. **Browser Entry**: `client/index.tsx` initializes the React application, mounting the root component and setting up error boundaries.

2. **Server Entry**: `vite.config.ts` configures the Vite development and preview servers, registering server hooks for search and inference endpoints.

3. **Container Entry**: `Dockerfile` starts both SearXNG and the Node.js server in a single process via shell command composition.

## Multi-Service Container Architecture

The Docker container runs three services concurrently:

- **SearXNG** - Privacy-focused metasearch engine
- **ONNX Runtime** - In-process inference for result reranking
- **Node.js application** - Main application server

The build creates a runtime image with Node.js and Python environments. The container entrypoint starts SearXNG in the background and then launches the Node.js application.

## State Management Architecture

MiniSearch uses a PubSub pattern for state management rather than React Context, enabling loose coupling between components and business logic modules:

PubSub channels are created using the create-pubsub package and provide type-safe publish/subscribe interfaces. Components subscribe via the usePubSub hook, and business logic modules publish state updates directly.

## Data Persistence Strategy

MiniSearch employs a dual-layer persistence approach:

- **IndexedDB** - Local storage for search history, settings, cached results, and saved AI transcripts
- **TTL-based caching** - 15-minute cache for search results to minimize API calls

Search history is backed by a Dexie database that keeps three coordinated tables (search runs, LLM responses, chat turns) along with automatic retention/max-entry cleanup. See `docs/search-history.md` for the complete schema and invariants. The caching layer minimizes redundant API calls to SearXNG while maintaining fresh results. Search results cached in IndexedDB have a 15-minute TTL, after which new searches bypass the cache.

Long-running chat sessions use an in-memory conversation summary that rolls excess turns into a structured digest before continuing generation. Details about the token budgeting and summary refresh flow live in `docs/conversation-memory.md`.

## Development and Production Modes

The system supports two operational modes:

### Development Mode

- Hot module replacement (HMR) on port 7861
- Volume mount for live code updates
- Vite dev server with source maps

### Production Mode

- Pre-built static assets in /dist
- Vite preview server (no HMR)
- Optimized bundle with minification

Both modes run the same underlying services (SearXNG, the reranker) but differ in how the frontend is served and rebuilt.

## Search and AI Integration Flow

The system executes two parallel flows when a user submits a query:

### Search Flow

1. User submits a query via SearchForm
2. Client checks IndexedDB cache for matching query hash
3. On cache miss: authenticated HTTP request to `/search/text` or `/search/images`
4. Server verifies request token via `searchToken.ts` (CSRF protection)
5. `webSearchService.ts` forwards query to SearXNG at `http://127.0.0.1:8888`
6. Raw results are deduplicated, cleaned, and optionally reranked
7. Thumbnails are proxied and converted to base64 Data URLs to avoid CORS issues
8. Results returned as structured JSON and cached in IndexedDB (15-minute TTL)

### AI Generation Flow

1. `textGeneration.ts` orchestrates response generation after search completes
2. State machine transitions: `idle` -> `loadingModel`/`preparingToGenerate` -> `awaitingSearchResults` -> `generating` -> `completed`/`failed`/`interrupted` (see Text Generation States below; `loadingModel` only occurs on the browser/Wllama path, other backends use `preparingToGenerate`)
3. Search results are formatted and injected into system prompt via `{{searchResults}}` placeholder. With `enablePageContentFetch` on, the pages behind the top results are read through `/page-content` first and their excerpts are appended to each result (see `docs/page-content.md`)
4. LLM generates response with streaming tokens
5. Response updates throttled to ~12 updates/sec via `throttleit` to prevent React render overload
6. Response saved to history database via `saveLlmResponseForQuery`

The `textGeneration` module orchestrates the entire search-to-response flow, managing search requests, LLM context preparation, and response streaming. Search results are optionally reranked in-process via ONNX Runtime before being passed to the LLM for response generation.

### Web Search Service Reliability

`server/webSearchService.ts` implements resilience patterns for SearXNG integration:

- **Circuit Breaker**: Opens after 5 consecutive failures, blocking requests for 60 seconds before attempting reset
- **Retry Logic**: Exponential backoff for HTTP 500 errors, up to 3 retries
- **Content Processing**: Converts HTML results to plain text, strips emojis for cleaner output
- **Thumbnail Proxying**: Server fetches external thumbnails and converts to base64 Data URLs, avoiding CORS issues and improving loading stability

### Search Token Lifecycle

CSRF protection uses a token the server owns for its lifetime:

1. **Generation**: `regenerateSearchToken()` writes a random token at build time, and on first use if the file is absent
2. **Storage**: Server stores token file at `{os.tempdir()}/minisearch-token`, read once per process and held in memory from then on
3. **Distribution**: Server serves the token to the client at runtime through `/api/config`, so a client always holds the token of the server answering it
4. **Client Hashing**: Client hashes token before sending in requests (never sends raw token)
5. **Verification**: Server compares request hash against the token it is holding
6. **Caching**: Verified tokens stored in `server/verifiedTokens.ts` (in-memory `Map` of token to last-seen time) to avoid redundant cryptographic operations
7. **Rejection Caching**: Tokens that fail a completed verification are kept in a bounded set (`server/rejectedTokens.ts`) until it evicts them at the cap, so a replay of a dead token is refused without a second argon2 verification; a verification that never produced a result, because the hash could not be parsed or the token file could not be read, leaves nothing behind

Rewriting the token file under a running server does not re-key it: the server keeps the token it is already handing out, and logs once that the file diverged if a request is rejected while it has.

## Data Flow and Communication

MiniSearch uses a PubSub-based architecture where state flows through independent channels. Components subscribe only to the channels they need, minimizing unnecessary re-renders.

### State Machine Transitions

**Text Generation States:**

- `idle` - No active generation
- `awaitingModelDownloadAllowance` - Waiting for user consent to download a browser model
- `loadingModel` - Downloading or initializing the browser (Wllama) model
- `awaitingSearchResults` - Waiting for search to complete before generating
- `preparingToGenerate` - Building the prompt/request just before calling the inference backend (OpenAI-compatible, Internal API, and AI Horde paths)
- `generating` - Streaming response tokens
- `interrupted` - Generation was cancelled by the user
- `completed` - Full response received
- `failed` - Error occurred

**Search States:**

- `idle` - No active search
- `running` - Search in progress
- `completed` - Results received
- `failed` - Error occurred

### API Request Authentication

1. Client retrieves cached token hash from `lastSearchTokenHashPubSub` (localStorage-backed)
2. If expired or missing, generates new hash from the `searchToken` in `/api/config`
3. Request includes hashed token as query parameter
4. Server hook verifies token against stored value
5. On success, token added to `verifiedTokens` Set for subsequent requests

### Response Throttling

Streaming LLM output produces token-by-token state changes that would overwhelm React's rendering pipeline. Two channels apply throttling via `throttleit`:

| Channel | Throttle Interval | Purpose |
|---------|-------------------|---------|
| `responsePubSub` | ~83ms (12/sec) | AI response text streaming |
| `reasoningContentPubSub` | ~83ms (12/sec) | Reasoning/thinking content streaming |

Callers write tokens directly to `updateResponse` or `updateReasoningContent` without awareness of internal throttling.

### Side Effects

Three channels register built-in side-effect subscribers at module load time for automatic logging:

| Channel | Side Effect |
| --------- | ------------- |
| `textGenerationStatePubSub` | Logs state transitions via `addLogEntry` |
| `textSearchStatePubSub` | Logs state transitions via `addLogEntry` |
| `imageSearchStatePubSub` | Logs state transitions via `addLogEntry` |

## Build and Deployment Pipeline

The build pipeline uses Biome for linting and formatting, TypeScript for type checking, and Vitest for testing. The Docker build compiles native dependencies from source in a builder stage, then copies only the necessary binaries to the final runtime image.

## Server Hook System

MiniSearch implements all server-side logic as Vite plugin hooks. Each hook registers middleware on Vite's HTTP server, working identically in both dev (`vite`) and production preview (`vite preview`) modes. Hooks are declared in `vite.config.ts` and registered via `configureServer`/`configurePreviewServer` callbacks.

| Hook | File | Purpose |
| ------ | ------ | --------- |
| `compressionServerHook` | `server/compressionServerHook.ts` | gzip/brotli compression for all responses |
| `crossOriginServerHook` | `server/crossOriginServerHook.ts` | COOP/COEP headers for SharedArrayBuffer |
| `searchEndpointServerHook` | `server/searchEndpointServerHook.ts` | `/search/text` and `/search/images` endpoints proxied to SearXNG |
| `pageContentEndpointServerHook` | `server/pageContentEndpointServerHook.ts` | `/page-content` endpoint that reads result pages for answer grounding |
| `statusEndpointServerHook` | `server/statusEndpointServerHook.ts` | `/status` health check endpoint |
| `cacheServerHook` | `server/cacheServerHook.ts` | Cache-Control headers (preview only) |
| `validateAccessKeyServerHook` | `server/validateAccessKeyServerHook.ts` | Access key validation endpoint |
| `internalApiEndpointServerHook` | `server/internalApiEndpointServerHook.ts` | `/inference` proxy to self-hosted API |
| `rerankerServiceHook` | `server/rerankerServiceHook.ts` | Reranker model lifecycle management for result reranking |

Key server-side modules:

- **`server/webSearchService.ts`**: Integrates with SearXNG at `http://127.0.0.1:8888`. Implements a circuit breaker (opens after 5 failures, resets after 60s) and retry logic (up to 3 retries with exponential backoff for 500 errors).
- **`server/pageContentService.ts`**: Reads result pages for answer grounding: SSRF-guarded fetches with a byte cap, readable-text extraction, and query-relevant passage selection.
- **`server/searchToken.ts`**: Manages a token at `{os.tempdir()}/minisearch-token` used for CSRF protection on search requests.
- **`server/verifiedTokens.ts`**: In-memory `Map` of verified session token to last-seen time, evicted after 30 idle minutes, plus a cumulative count of the distinct sessions seen since the last restart.
- **`server/rejectedTokens.ts`**: Bounded in-memory set of tokens that already failed a completed verification, so a replay is refused without a second argon2 check until the set evicts it at the cap; a token refused once cannot become valid in the same process, so the set is exact, and a token that never got a verification result never occupies a slot.
- **`server/searchesSinceLastRestart.ts`**: In-memory counters for search analytics.

### Cache Control

The `cacheServerHook` sets Cache-Control headers on every response:

| Path Pattern | Cache-Control Header | Rationale |
| --- | --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` | Content-hashed filenames never change |
| `/` or `*.html` | `no-cache` | HTML must always check for updates |
| Everything else | `public, max-age=86400, must-revalidate` | 24-hour cache with revalidation |

### Status Endpoint

The `/status` endpoint returns a JSON object:

| Field | Type | Description |
| --- | --- | --- |
| `uptime` | string | Human-readable server uptime |
| `sessions` | number | Distinct verified sessions since last restart, which the two per-session averages below divide by |
| `activeSessions` | number | Sessions still in the cache, dropped after 30 idle minutes |
| `textualSearches` | number | Text search count since last restart |
| `graphicalSearches` | number | Image search count since last restart |
| `averageTextualSearchesPerSession` | number | Text searches / sessions ratio |
| `averageGraphicalSearchesPerSession` | number | Image searches / sessions ratio |
| `searchesWithoutResults` | number | Searches, text and image together, that SearXNG answered with zero results and no unresponsive engines |
| `searchesWithUnresponsiveEngines` | number | Searches, text and image together, that SearXNG answered with zero results while naming unresponsive engines |
| `searchesWithAllResultsDiscarded` | number | Text searches whose results were all dropped during processing |
| `rerankerServiceStatus` | string | `"healthy"` or `"unhealthy"` |
| `webSearchServiceStatus` | string | `"healthy"` or `"unhealthy"` |
| `pageReads` | object | Page-reading counters since last restart, see below |
| `authorization` | object | Token and rate-limit outcomes since last restart, see below |
| `inference` | object | AI answer counters since last restart, see below |
| `searches` | object | Search timing, circuit state and grounding, see below |
| `reranker` | object | Reranking cost and effect, see below |
| `thumbnails` | object | Image thumbnail fetches, see below |
| `build.timestamp` | string | ISO 8601 build time |
| `build.gitCommit` | string | Short Git commit hash |

The three `searches...` counters are the aggregate form of the log lines that
used to carry the query text. The log still names the unresponsive engines
behind an empty response and the size and type of a discarded batch; how often
each happens is read from here instead. `searchesWithoutResults` counts only
the searches that genuinely matched nothing, since an empty response naming
unresponsive engines fails the search rather than returning zero results (see
`docs/failure-injection.md`); `searchesWithUnresponsiveEngines` counts those,
which is the way to tell whether the case is being over-classified. It
undercounts a sustained outage, where the circuit breaker short-circuits before
`performSearch` is reached. The discarded count covers text searches only,
because an image result is never dropped at this stage: an unusable
thumbnail is dropped later, when `searchEndpointServerHook` fetches it.

`pageReads` reports what happened to the pages read for AI answers. Each field
is attached to a constant that someone will want to move, which is the reason it
is counted at all (see `docs/page-content.md`):

| Field | Type | Tunes |
| --- | --- | --- |
| `requested` | number | Nothing; the denominator for the rest |
| `read` | number | Nothing; how often the feature contributed anything |
| `readRate` | number | Nothing; `read` as a percentage of `requested` |
| `averageReadMs` | number | `REQUEST_TIMEOUT_MS`, including the reads that hit it |
| `bodiesTruncated` | number | `MAX_RESPONSE_BYTES` |
| `excerptKeptRate` | number | `MAX_PAGE_CHARS` and the 0.9 dedup threshold, as the share of pooled passages that survive |
| `skipped.blocked` | number | The SSRF guard, and how often callers aim at private space |
| `skipped.notADocument` | number | `READABLE_CONTENT_TYPES` |
| `skipped.httpError` | number | Nothing; how often sites refuse the instance |
| `skipped.redirectLimit` | number | `MAX_REDIRECTS` |
| `skipped.timedOut` | number | `REQUEST_TIMEOUT_MS` |
| `skipped.tooLittleText` | number | `MIN_USEFUL_CHARS`, and the extractor's selectors |
| `skipped.failed` | number | Nothing; the residue worth watching for a pattern |
| `grounding.requests` | number | Nothing; the denominator for the two below |
| `grounding.withContent` | number | Nothing; requests where at least one page yielded text |
| `grounding.withoutContent` | number | The budgets and timeouts above, read per request instead of per page: six pages at a 50% read rate can be three fully grounded answers or six half-grounded ones |

`read` plus every `skipped` entry sums to `requested`, so a page that goes
uncounted shows up as a gap rather than being lost silently.

`grounding` counts `/page-content` requests and not searches. A search only
reaches that endpoint when the browser has AI responses on, page reading on,
and the search returned results, and AI responses are off by default, so
`grounding.requests` sitting at zero while `textualSearches` climbs means
nobody asked for an answer, not that nothing could be read.

`authorization` reports what happened to the requests that reached token
verification, the funnel `/search/text`, `/search/images`, `/page-content` and
`/inference` all pass through:

| Field | Type | Says |
| --- | --- | --- |
| `requests` | number | Requests that reached verification; the denominator for the rest |
| `authorized` | number | Requests that passed it |
| `rejectedRate` | number | Rejections as a percentage of `requests` |
| `reasons.rateLimited` | number | Refused by the limiter before anything else ran |
| `reasons.missingToken` | number | No token on the request, which is what an outdated client looks like |
| `reasons.invalidToken` | number | A token that failed verification, which is what probing looks like |
| `bySurface` | object | `authorized` and `rejected` per endpoint family: `search`, `pageContent`, `inference`, `other` |
| `rejectedTokenCacheHits` | number | Rejections served from the rejected-token cache without a second argon2 verification |
| `limiter` | object | The limiter's `points` and `durationSeconds`, without which a rejection count says nothing |

`authorized` plus every entry of `reasons` sums to `requests`, and each half of
`bySurface` sums to its side of that, on the same principle as `pageReads`.
`rejectedTokenCacheHits` counts a subset of `reasons.invalidToken` rather
than adding to that sum.

The limiter keys on the client IP and none of that reaches these counters: no
address, no token, no query, no per-request timestamp. The cut is by reason and
by surface, both properties of the request rather than of whoever sent it.
`bySurface` is the one worth watching: all four endpoints share one budget and
a single user action fans out into a text search, an image search and a
page-content read, so its `authorized` side says where the budget goes and its
`rejected` side says who pays for it running out.

`inference` reports what happened to the AI answers served through
`/inference`. Nothing about the conversation is kept, so the questions it can
answer are about the upstream and about the wait, not about what was asked:

| Field | Type | Says |
| --- | --- | --- |
| `requests` | number | Requests that passed token verification; the denominator for the rest |
| `streamed` | number | Answers that finished normally |
| `streamedRate` | number | `streamed` as a percentage of `requests` |
| `averageTimeToFirstTokenMs` | number | The wait the user actually feels, over the answers that produced a token |
| `averageDurationMs` | number | Whole-request duration over every outcome, so a 2 ms rejected body and a 25 s answer land in the same average |
| `averageAttempts` | number | Models tried, over the requests that reached the model loop; above 1 means the pool is carrying failures |
| `modelFallbacks` | number | Times a retry moved to another model |
| `modelsRefetched` | number | Times the model pool was re-listed mid-retry |
| `streamsEndedWithoutFinish` | number | Attempts whose stream closed with no finish part, counted per attempt because the retry can still succeed |
| `failed.failedBeforeFirstToken` | number | Every model failed before a token was sent, answered 503 |
| `failed.failedMidStream` | number | The answer broke after content was already sent, so no retry was possible |
| `failed.abandoned` | number | The client was gone before or during the answer; the only outcome with no response to observe it by |
| `failed.badRequest` | number | Body too large, unparsable, or failing the schema |
| `failed.notConfigured` | number | `INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL` or its key is missing |
| `failed.modelListUnavailable` | number | The upstream's model list could not be fetched |
| `failed.noModelAvailable` | number | The list was fetched and held nothing usable |
| `failed.internalError` | number | Anything the handler did not expect |
| `failed.unclassified` | number | Should always be zero; a non-zero value means a path stopped reporting its outcome |
| `byModel` | object | `attempted`, `streamed`, `failed` and `abandoned` per model id, which is how a dead member of the pool becomes visible. `attempted` equals the other three added up |

`streamed` plus every `failed` entry sums to `requests`. A request refused at
token verification is not counted here, since `authorization` above already
counts it, and one refused for its method or its content type is answered
before either counter is reached. So `inference.requests` should equal
`authorization.bySurface.inference.authorized`, and a gap between the two is a
request that never finished at all.

Two fields read differently on a single-model deployment. With
`INTERNAL_OPENAI_COMPATIBLE_API_MODEL` set there is no pool to fall back to, so
the loop stops after the first failure: `averageAttempts` cannot exceed 1 and
`modelFallbacks` stays at 0 however badly the upstream behaves. The pool also
never refreshes in that mode, so `modelsRefetched` stays at 0; read
`failed.failedBeforeFirstToken` for that case instead.

Model ids are configuration rather than user data, and `/inference` already
sends the id to the browser in every chunk, so naming them here publishes
nothing new.

`searches`, `reranker` and `thumbnails` are the numbers behind the constants
in the search path. Each row names the constant it is there to move, the same
way `pageReads` does:

| Field | Type | Tunes |
| --- | --- | --- |
| `searches.averageTextualMs` | number | The 30 s client timeout in `client/modules/search.ts`. Over the text searches SearXNG answered, so a failed or short-circuited one is not in it, and up to 7 s of retry backoff is |
| `searches.averageGraphicalMs` | number | The same, for image searches |
| `reranker.considered` | number | Nothing; results handed to the score filter, the denominator for `keptRate` |
| `reranker.kept` | number | Nothing; results that survived it |
| `searches.circuitState` | string | Nothing; whether searches are being short-circuited right now |
| `searches.circuitOpens` | number | `failureThreshold` and `resetTimeout` on the SearXNG breaker: each opening is a minute of serving no searches at all |
| `reranker.reranks` | number | Nothing; the denominator for the rest |
| `reranker.averageMs` | number | Whether reranking or SearXNG is what users wait for, and so whether to rerank a shortlist instead of all 30 results. Over `reranks`, covering the filtering and sorting as well as the model |
| `reranker.keptRate` | number | `kStandardDeviationFactor`: near 100% means the filter is not filtering. Text and image reranks are pooled, and the two run through different paths, so this moves with the traffic mix as well as with the threshold |
| `reranker.fallbackApplied` | number | `minPercentageFallback`: a large share means the deviation threshold is emptying batches the fallback then has to rescue |
| `reranker.skippedUnhealthy` | number | Nothing; searches served in SearXNG's own order because the model was not loaded |
| `reranker.failed` | number | Nothing; the same, because reranking threw |
| `thumbnails.requested` | number | Nothing; the denominator for the two below |
| `thumbnails.dropped` | number | `THUMBNAIL_TIMEOUT_MS` and `MAX_THUMBNAIL_BYTES`: every one of these is an image result the user never saw |
| `thumbnails.blocked` | number | The SSRF guard, as the share of thumbnails pointing outside public space |

`thumbnails.dropped` includes the blocked ones, so `requested` minus `dropped`
is what reached the client.

## Data Persistence Architecture

MiniSearch uses a multi-layered client-side persistence strategy:

### IndexedDB Databases

Two separate Dexie databases handle different persistence needs:

1. **SearchCacheDatabase** (`client/modules/search.ts`): Temporary cache for search results with TTL-based expiration. Table schema:
   - `textSearchHistory`: Keyed by hashed query, indexed by timestamp
   - `imageSearchHistory`: Keyed by hashed query, indexed by timestamp
   - Cache config:

| Constant | Value | Description |
| ---------- | ------- | ------------- |
| TTL | 15 minutes | Cache entry lifetime |
| MAX_ENTRIES | 100 | Maximum cached queries per store |
| ENABLED | true | Global cache toggle |
| PRUNE_INTERVAL | 10 | Cache writes between LRU prune passes |
| METRICS_LOG_INTERVAL | 10 | Operations between hit-rate log entries |
| REQUEST_TIMEOUT | 30,000 ms | Fetch timeout |

- Query hashing: djb2 XOR Murmur algorithm for cache key generation
- Management operations: `cleanExpiredCache`, `pruneCache`, `ensureIntegrity`
- Performance monitoring: `cacheMetrics` tracks hit/miss rates for text and image searches

1. **HistoryDatabase** (`client/modules/history.ts`): Long-term persistence of user interactions. Three coordinated tables:
   - `searches`: Canonical log of each query with hydrated results payloads
   - `llmResponses`: AI answers tied to their originating search run
   - `chatHistory`: Chronological chat turns scoped by `conversationId` (which equals `searchRunId`)
   - Auto-cleanup: Enforces retention window and max entries, with pin protection

### localStorage Persistence

Lightweight state persisted across sessions via `createLocalStoragePubSub` pattern:

- `settings`: Application preferences (inference type, model, UI options)
- `querySuggestions`: Shuffled search suggestion pool
- `lastSearchTokenHash`: Cached security token hash
- `menuExpandedAccordions`: UI state for settings menu sections
- `showFeatureTips`: Whether the menu's dismissible feature-tips hint is still shown

## Application Bootstrap Flow

### Server-Side Bootstrap (vite.config.ts)

1. Loads environment variables via `dotenv.config`
2. Regenerates the search token used for CSRF protection, on build only
3. Injects build metadata as compile-time replacements (`VITE_BUILD_DATE_TIME`, `VITE_COMMIT_SHORT_HASH`)
4. Registers all middleware hooks (see Server Hook System above)

### Client-Side Bootstrap (client/index.tsx)

1. Retrieves current settings via `getSettings()`
2. Registers ready/close listeners on `historyDatabase`, opens DB if history enabled
3. Sets up reactive listener to open/close DB when user toggles history in settings
4. Creates React root and renders `<App />`

### App Component Initialization (client/components/App/App.tsx)

1. `useInitializeSettings`: Merges default settings with stored values into `settingsPubSub`
2. `useAccessKeyValidation`: Checks `VITE_ACCESS_KEYS_ENABLED`; if enabled, verifies stored key; shows loading state during check; renders `<AccessPage />` or `<MainPage />` accordingly

## Access Control and Security

MiniSearch supports optional access key authentication for restricting usage. When the ACCESS_KEYS environment variable is set, the server validates incoming requests against the configured keys. Rate limiting is applied to search and inference endpoints to prevent abuse.

Access keys are verified server-side before proxying requests to SearXNG or processing inference requests. The ACCESS_KEY_TIMEOUT_HOURS variable controls how long a valid access key remains cached.

For complete security details, see `docs/security.md`.

## Related Topics

- **Quick Start**: `docs/quick-start.md` - Installation and first run
- **Configuration**: `docs/configuration.md` - All environment variables and settings
- **AI Integration**: `docs/ai-integration.md` - Detailed AI inference options
- **UI Components**: `docs/ui-components.md` - Component architecture and state management
- **Search History**: `docs/search-history.md` - History database and management
- **Conversation Memory**: `docs/conversation-memory.md` - Token budgeting and summaries
- **Security**: `docs/security.md` - Access control and privacy model
- **Development**: `docs/development-commands.md` - Available commands
