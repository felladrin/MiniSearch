# Glossary

Codebase-specific terms, jargon, and domain concepts used in MiniSearch.

## Core System Concepts

### Search Token & Hash

A security mechanism used to authorize communication between the client and the internal search/AI endpoints.

- **Search Token**: A string generated at build time (`VITE_SEARCH_TOKEN`). Used to verify that requests to the server originate from a trusted build.
- **Search Token Hash**: To avoid exposing the raw token in all requests, the client generates a hash of the token. Managed via the `lastSearchTokenHashPubSub` channel.
- **Verification**: The server verifies these tokens to prevent unauthorized access to the search API. Stored in `server/verifiedTokens.ts` as an in-memory `Set<string>`.

### Inference Types

MiniSearch supports multiple backends for Large Language Model (LLM) inference, configured via `inferenceType` in the application settings.

| Type | Description | Implementation |
|------|-------------|----------------|
| `browser` | Local inference using WASM (Wllama) | Client-side, privacy-preserving |
| `openai` | Connection to any OpenAI-compatible external API | Requires API key |
| `horde` | Crowdsourced inference via the AI Horde network | Distributed, anonymous or authenticated |
| `internal` | Server-side proxy using pre-configured credentials | API key hidden from client |

### PubSub (State Management)

Instead of a heavy state management library like Redux, MiniSearch uses a minimalist Publish-Subscribe pattern powered by the `create-pubsub` library.

- **Data Flow**: Components subscribe to "channels" (e.g., `queryPubSub`, `responsePubSub`)
- **Tuple Pattern**: Each channel is a 3-element tuple: `[update, subscribe, get]`
- **Persistence**: Some channels use `createLocalStoragePubSub` to automatically sync state with `localStorage`
- **Throttling**: UI-heavy updates like AI response streaming are throttled to ~12 updates/sec using `throttleit`

### Reranker

A secondary search stage that takes initial results from SearXNG and re-orders them based on relevance to the query using a cross-encoder model (`jina-reranker-v1-tiny-en`) running on a local `llama-server` instance.

- **Implementation**: Spawns `llama-server` child process with `--reranking` and `--pooling rank` flags
- **Health Check**: Polls `/health` endpoint via `getRerankerStatus`
- **Scoring**: Results filtered using standard deviation thresholds (`kStandardDeviationFactor = 0.3`)
- **Fallback**: If reranker is unhealthy, returns unranked SearXNG results

### Wllama

A WebAssembly (WASM) based integration of `llama.cpp` for running LLMs on the CPU in the browser.

- **Initialization**: Loads models from HuggingFace using `initializeWllama`
- **Warmup**: Includes a warmup phase with a single token completion using `n_threads: 1`
- **OPFS**: Uses the Origin Private File System via Wllama's cache manager to store model shards locally
- **Models**: GGUF format, Q4_K_S or UD-Q4_K_XL quantized, stored at `Felladrin/gguf-sharded-*` on HuggingFace

### AI Horde

A crowdsourced distributed cluster of workers providing AI inference. MiniSearch integrates with it using a polling strategy against the `/generate/text/status` endpoint.

- **Kudos**: Virtual currency used by the Horde. Default anonymous key is `0000000000`
- **Polling**: Requests sent to async API, status checked periodically until completion
- **Cancellation**: Can abort generation via `DELETE` on the status endpoint

### Conversation Memory & Rolling Summary

A mechanism to handle long chats that exceed the LLM context window.

- **Summarization**: When older messages are dropped, `createLlmSummary` asks the LLM to condense them under a limit of 800 tokens
- **Extractive Fallback**: If LLM summarization fails, `summarizeDroppedMessages` uses a token-counting extractive approach
- **Token Budget**: Computed based on `openAiContextLength` setting and current message count

## Technical Jargon & Abbreviations

### SearXNG

A privacy-respecting metasearch engine that aggregates results from multiple search engines without tracking. Runs locally on port 8888 within the Docker container.

### GGUF

GPT-Generated Unified Format. Binary format for storing LLM weights, optimized for fast loading and inference. Used by Wllama and llama-server.

### Dexie

A minimalist wrapper for IndexedDB used for client-side persistence. MiniSearch uses two Dexie databases:
- **SearchCacheDatabase**: Temporary cache with TTL-based expiration
- **HistoryDatabase**: Long-term search history with retention policies

### Vite Server Hooks

Middleware registered via Vite plugin hooks (`configureServer`, `configurePreviewServer`). All server-side logic in MiniSearch is implemented as hooks:

| Hook | Purpose |
|------|---------|
| `compressionServerHook` | gzip/brotli compression |
| `crossOriginServerHook` | COOP/COEP headers for SharedArrayBuffer |
| `searchEndpointServerHook` | `/search/text` and `/search/images` endpoints |
| `statusEndpointServerHook` | `/status` health check |
| `cacheServerHook` | Cache-Control headers |
| `validateAccessKeyServerHook` | Access key validation |
| `internalApiEndpointServerHook` | `/inference` proxy |
| `rerankerServiceHook` | llama-server lifecycle management |

### Circuit Breaker

A resilience pattern used in `webSearchService.ts` to handle SearXNG service degradation. Opens after 5 consecutive failures, blocking requests for 60 seconds before attempting reset.

### LRU Pruning

Least Recently Used cache eviction strategy. The search cache prunes oldest entries every 10 writes when `MAX_ENTRIES` (100) is reached.

### Argon2id

A password hashing algorithm used for access key validation. Client hashes the access key before transmission; server verifies against configured keys.

## Data Structures

### SearchCacheDatabase Schema

| Store | Primary Key | Indexed Field | Entry Type |
|-------|-------------|---------------|------------|
| `textSearchHistory` | key (hash) | timestamp | TextSearchCache |
| `imageSearchHistory` | key (hash) | timestamp | ImageSearchCache |

### HistoryDatabase Schema

| Table | Purpose |
|-------|---------|
| `searches` | Canonical log of each query with hydrated results payloads |
| `llmResponses` | AI answers tied to their originating search run |
| `chatHistory` | Chronological chat turns scoped by `conversationId` |

### PubSub Channel Types

| Channel | Data Type | Persistence |
|---------|-----------|-------------|
| `queryPubSub` | `string` | Memory |
| `responsePubSub` | `string` | Memory (throttled) |
| `settingsPubSub` | `Settings` | localStorage |
| `textSearchResultsPubSub` | `TextSearchResults` | Memory |
| `textGenerationStatePubSub` | `TextGenerationState` | Memory |
| `chatMessagesPubSub` | `ChatMessage[]` | Memory |
| `conversationSummaryPubSub` | `{id, summary}` | Memory |

## Related Topics

- **Overview**: `docs/overview.md` - System architecture
- **Configuration**: `docs/configuration.md` - Environment variables and settings
- **UI Components**: `docs/ui-components.md` - Component architecture
- **Reranking**: `docs/reranking.md` - Reranker subsystem
