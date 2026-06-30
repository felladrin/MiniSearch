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
- **llama-server** - Local AI inference server
- **Node.js application** - Main application server

The multi-stage build process first compiles llama-server from source, then creates the final runtime image with Node.js and Python environments. The container entrypoint starts SearXNG in the background and then launches the Node.js application.

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

Both modes run the same underlying services (SearXNG, llama-server) but differ in how the frontend is served and rebuilt.

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
3. Search results are formatted and injected into system prompt via `{{searchResults}}` placeholder
4. LLM generates response with streaming tokens
5. Response updates throttled to ~12 updates/sec via `throttleit` to prevent React render overload
6. Response saved to history database via `saveLlmResponseForQuery`

The `textGeneration` module orchestrates the entire search-to-response flow, managing search requests, LLM context preparation, and response streaming. Search results are optionally reranked using a local llama-server instance before being passed to the LLM for response generation.

### Web Search Service Reliability

`server/webSearchService.ts` implements resilience patterns for SearXNG integration:

- **Circuit Breaker**: Opens after 5 consecutive failures, blocking requests for 60 seconds before attempting reset
- **Retry Logic**: Exponential backoff for HTTP 500 errors, up to 3 retries
- **Content Processing**: Converts HTML results to plain text, strips emojis for cleaner output
- **Thumbnail Proxying**: Server fetches external thumbnails and converts to base64 Data URLs, avoiding CORS issues and improving loading stability

### Search Token Lifecycle

CSRF protection uses a build-time generated token:

1. **Generation**: Token created at build time in `vite.config.ts` and injected as `VITE_SEARCH_TOKEN`
2. **Storage**: Server stores token file at `{os.tempdir()}/minisearch-token`
3. **Client Hashing**: Client hashes token before sending in requests (never sends raw token)
4. **Verification**: Server compares request hash against stored token
5. **Caching**: Verified tokens stored in `server/verifiedTokens.ts` (in-memory `Set<string>`) to avoid redundant cryptographic operations

## Data Flow and Communication

MiniSearch uses a PubSub-based architecture where state flows through independent channels. Components subscribe only to the channels they need, minimizing unnecessary re-renders.

### State Machine Transitions

**Text Generation States:**
- `idle` - No active generation
- `awaitingModelDownloadAllowance` - Waiting for user consent to download a browser model
- `loadingModel` - Downloading or initializing the browser (Wllama) model
- `awaitingSearchResults` - Waiting for search to complete before generating (only when `searchResultsToConsider > 0`)
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
2. If expired or missing, generates new hash from `VITE_SEARCH_TOKEN`
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
|---------|-------------|
| `textGenerationStatePubSub` | Logs state transitions via `addLogEntry` |
| `textSearchStatePubSub` | Logs state transitions via `addLogEntry` |
| `imageSearchStatePubSub` | Logs state transitions via `addLogEntry` |

## Build and Deployment Pipeline

The build pipeline uses Biome for linting and formatting, TypeScript for type checking, and Vitest for testing. The Docker build compiles native dependencies from source in a builder stage, then copies only the necessary binaries to the final runtime image.

## Server Hook System

MiniSearch implements all server-side logic as Vite plugin hooks. Each hook registers middleware on Vite's HTTP server, working identically in both dev (`vite`) and production preview (`vite preview`) modes. Hooks are declared in `vite.config.ts` and registered via `configureServer`/`configurePreviewServer` callbacks.

| Hook | File | Purpose |
|------|------|---------|
| `compressionServerHook` | `server/compressionServerHook.ts` | gzip/brotli compression for all responses |
| `crossOriginServerHook` | `server/crossOriginServerHook.ts` | COOP/COEP headers for SharedArrayBuffer |
| `searchEndpointServerHook` | `server/searchEndpointServerHook.ts` | `/search/text` and `/search/images` endpoints proxied to SearXNG |
| `statusEndpointServerHook` | `server/statusEndpointServerHook.ts` | `/status` health check endpoint |
| `cacheServerHook` | `server/cacheServerHook.ts` | Cache-Control headers (preview only) |
| `validateAccessKeyServerHook` | `server/validateAccessKeyServerHook.ts` | Access key validation endpoint |
| `internalApiEndpointServerHook` | `server/internalApiEndpointServerHook.ts` | `/inference` proxy to self-hosted API |
| `rerankerServiceHook` | `server/rerankerServiceHook.ts` | llama-server lifecycle management for result reranking |

Key server-side modules:

- **`server/webSearchService.ts`**: Integrates with SearXNG at `http://127.0.0.1:8888`. Implements a circuit breaker (opens after 5 failures, resets after 60s) and retry logic (up to 3 retries with exponential backoff for 500 errors).
- **`server/searchToken.ts`**: Manages a token at `{os.tempdir()}/minisearch-token` used for CSRF protection on search requests.
- **`server/verifiedTokens.ts`**: In-memory `Set<string>` of verified session tokens.
- **`server/searchesSinceLastRestart.ts`**: In-memory counters for search analytics.

### Cache Control

The `cacheServerHook` sets Cache-Control headers on every response:

| Path Pattern | Cache-Control Header | Rationale |
|---|---|---|
| `/assets/*` | `public, max-age=31536000, immutable` | Content-hashed filenames never change |
| `/` or `*.html` | `no-cache` | HTML must always check for updates |
| Everything else | `public, max-age=86400, must-revalidate` | 24-hour cache with revalidation |

### Status Endpoint

The `/status` endpoint returns a JSON object:

| Field | Type | Description |
|---|---|---|
| `uptime` | string | Human-readable server uptime |
| `sessions` | number | Active verified token sessions |
| `textualSearches` | number | Text search count since last restart |
| `graphicalSearches` | number | Image search count since last restart |
| `averageTextualSearchesPerSession` | number | Text searches / sessions ratio |
| `averageGraphicalSearchesPerSession` | number | Image searches / sessions ratio |
| `rerankerServiceStatus` | string | `"healthy"` or `"unhealthy"` |
| `webSearchServiceStatus` | string | `"healthy"` or `"unhealthy"` |
| `build.timestamp` | string | ISO 8601 build time |
| `build.gitCommit` | string | Short Git commit hash |

## Data Persistence Architecture

MiniSearch uses a multi-layered client-side persistence strategy:

### IndexedDB Databases

Two separate Dexie databases handle different persistence needs:

1. **SearchCacheDatabase** (`client/modules/search.ts`): Temporary cache for search results with TTL-based expiration. Table schema:
   - `textSearchHistory`: Keyed by hashed query, indexed by timestamp
   - `imageSearchHistory`: Keyed by hashed query, indexed by timestamp
   - Cache config:

| Constant | Value | Description |
|----------|-------|-------------|
| TTL | 15 minutes | Cache entry lifetime |
| MAX_ENTRIES | 100 | Maximum cached queries per store |
| ENABLED | true | Global cache toggle |
| PRUNE_INTERVAL | 10 | Cache writes between LRU prune passes |
| METRICS_LOG_INTERVAL | 10 | Operations between hit-rate log entries |
| REQUEST_TIMEOUT | 30,000 ms | Fetch timeout |

   - Query hashing: djb2 XOR Murmur algorithm for cache key generation
   - Management operations: `cleanExpiredCache`, `pruneCache`, `ensureIntegrity`
   - Performance monitoring: `cacheMetrics` tracks hit/miss rates for text and image searches

2. **HistoryDatabase** (`client/modules/history.ts`): Long-term persistence of user interactions. Three coordinated tables:
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

## Application Bootstrap Flow

### Server-Side Bootstrap (vite.config.ts)
1. Loads environment variables via `dotenv.config`
2. Generates/retrieves search token for CSRF protection
3. Injects environment-based constants as compile-time replacements (`VITE_SEARCH_TOKEN`, `VITE_ACCESS_KEYS_ENABLED`, etc.)
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
