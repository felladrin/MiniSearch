# AI Integration

MiniSearch supports four AI inference backends, each with different trade-offs between privacy, performance, and setup complexity.

## Inference Types Overview

| Type | Privacy | Speed | Setup | Best For |
|------|---------|-------|-------|----------|
| **Browser** (Wllama) | Maximum (no data leaves device) | Fast (WebGPU) / Slow (CPU) | None | Personal use, privacy-critical scenarios |
| **OpenAI** | Low (data sent to OpenAI) | Very Fast | API Key | Maximum quality, convenience |
| **AI Horde** | Medium (distributed volunteers) | Variable | Anonymous | Free GPU access, no setup |
| **Internal** | High (your infrastructure) | Depends on hardware | Self-hosted API | Teams, compliance requirements |

## Browser-Based Inference

Runs AI models entirely in the browser using WebAssembly or WebGPU. No data leaves the user's device.

### Wllama

Uses `@wllama/wllama` for browser-based inference. Automatically uses WebGPU when available, falling back to CPU via WebAssembly.

**Requirements:**
- Any modern browser
- ~300MB-2GB free RAM
- WebGPU optional (Chrome 113+, Edge 113+) - enables GPU acceleration

**How It Works:**
1. Checks WebGPU availability via `"gpu" in navigator`
2. Downloads model from HuggingFace (GGUF format, cached in the browser's Origin Private File System)
3. Loads model with `n_gpu_layers: 99999` if WebGPU is present, else `0` for CPU-only
4. Runs a single-threaded warmup pass, then reloads with full thread count
5. Streams tokens via the OAI-compatible `createChatCompletion` API

**Pre-configured Models:**
All stored at `Felladrin/gguf-sharded-*` on HuggingFace. MiniSearch currently ships 35 pre-configured models, ranging from SmolLM 2 135M (~100MB) up to Phi 4 Mini Reasoning 3.8B (~2.4GB). The full, authoritative list with HuggingFace repo IDs and sizes lives in `client/modules/wllama.ts` (`wllamaModels`) and is rendered in the Settings dropdown; refer to that file rather than a static table here, since models are added/swapped frequently.

**Configuration:**
- Settings → Inference Type: `Browser`
- Settings → Wllama Model: Select from dropdown
- Settings → CPU threads: Relevant only when WebGPU is unavailable

**WebGPU Detection:**
```typescript
// client/modules/webGpu.ts
/** Whether the browser supports the WebGPU API. */
export const isWebGPUAvailable = "gpu" in navigator;
```

**Limitations:**
- First load requires model download (progressive via sharded files)
- Limited to smaller models (~4B params max due to browser memory)
- CPU mode is 2-5x slower than WebGPU

## OpenAI API Integration

Uses OpenAI's API or any OpenAI-compatible service.

**Setup:**
1. Get API key from OpenAI or compatible provider
2. Settings → Inference Type: `OpenAI`
3. Settings → OpenAI API Key: Enter key
4. Settings → OpenAI Model: Select or enter model ID

**Supported Providers:**
- OpenAI (gpt-4, gpt-3.5-turbo)
- Anthropic (via OpenAI-compatible endpoint)
- Google (Gemini via OpenAI-compatible endpoint)
- Any custom provider with OpenAI-compatible API

**Features:**
- Streaming responses, built on the Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`)
- Auto model selection (if blank)
- On a request error, automatically retries up to 5 times, switching to a different model fetched from the provider's `/models` endpoint each time (100ms × attempt backoff between retries)
- Reasoning content support: reasoning/thinking output is wrapped between configurable `reasoningStartMarker`/`reasoningEndMarker` settings (default `<think>` / `</think>`)

**Configuration:**
```typescript
{
  inferenceType: 'openai',
  openAiApiKey: 'sk-xxx',
  openAiApiModel: 'gpt-4', // Optional: auto-detected if empty
  openAiContextLength: 4096
}
```

**Privacy Considerations:**
- Search queries and results sent to OpenAI
- Not suitable for sensitive data
- Consider internal API for private data

## AI Horde Integration

Uses aihorde.net, a distributed volunteer GPU network.

**Setup:**
1. Settings → Inference Type: `AI Horde`
2. (Optional) Settings → AI Horde API Key: Get from aihorde.net
3. Settings → AI Horde Model: Select preferred model

**How It Works:**
1. Request sent to AI Horde API
2. Distributed to volunteer workers
3. Multiple workers may process in parallel
4. First response wins (race condition handling)
5. Results streamed back

**Features:**
- Free to use (anonymous or authenticated)
- Kudos-based priority system
- Large model selection (70B+ params available)
- No API key required (but recommended for priority)

**Configuration:**
```typescript
{
  inferenceType: 'horde',
  hordeApiKey: '0000000000', // Default anonymous key; set your own for priority
  hordeModel: '' // Optional; empty races two random workers and uses the first response
}
```

**Limitations:**
- Variable latency (depends on worker availability)
- Quality varies by worker
- May queue during high demand
- Requires internet connection

## Internal API Integration

Self-hosted OpenAI-compatible API for teams and compliance.

**Setup:**
1. Host an OpenAI-compatible API (e.g., vLLM, llama.cpp server, Ollama with OpenAI compat)
2. Configure environment variables (see `docs/configuration.md`)
3. Settings → Inference Type: `Internal`

**Environment Variables:**
```bash
INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL="https://llm.company.com/v1"
INTERNAL_OPENAI_COMPATIBLE_API_KEY="sk-internal-xxx"
INTERNAL_OPENAI_COMPATIBLE_API_MODEL="llama-3.1-8b"
INTERNAL_OPENAI_COMPATIBLE_API_NAME="Company LLM"
```

**Server-Side Proxy:**
The internal API uses a server-side proxy to:
- Hide API keys from client
- Add request logging/auditing
- Apply rate limiting
- Enable token-based authentication

**Endpoint:**
```
POST /inference?token=<argon2-hashed-search-token>
Content-Type: application/json

{
  "messages": [...],
  "temperature": 0.35,
  "top_p": 1.0,
  "max_tokens": 4096,
  "stream": true
}
```

The token is passed as a URL query parameter (`?token=`), verified server-side with Argon2 against the build-time `VITE_SEARCH_TOKEN`, not as an `Authorization: Bearer` header. The model field is optional; if `INTERNAL_OPENAI_COMPATIBLE_API_MODEL` is unset, the server fetches and randomly selects from the upstream's available models.

**Features:**
- Private data stays in your infrastructure
- Custom model selection
- Server-side logging
- Compatible with any OpenAI-compatible API

**Recommended Self-Hosted Options:**
- **vLLM**: High-performance, production-ready
- **llama.cpp server**: Single binary, easy setup
- **Ollama**: Simple, Docker-friendly
- **text-generation-webui**: Feature-rich, UI included

## Text Generation Flow

### Search-Triggered Generation

```
User Query
    ↓
searchAndRespond() [client/modules/textGeneration.ts]
    ↓
startTextSearch() → searchText() [search.ts]
    ↓
Wait for search results
    ↓
canStartResponding() checks state
    ↓
Load AI model (if browser-based)
    ↓
Generate system prompt with search results
    ↓
Stream response via selected inference type
    ↓
Update PubSub channels (response, textGenerationState)
```

The AI context includes the top 6 text search results (a fixed value, `searchResultsToConsider` in `client/modules/textGenerationUtilities.ts`), not a user-configurable setting.

### Chat Generation

```
User sends message
    ↓
generateChatResponse() [textGeneration.ts]
    ↓
Manage token budget (75% of 4096 = ~3072 tokens)
    ↓
Create conversation summary if needed (800-token limit)
    ↓
Build context: System prompt + Summary + Recent turns
    ↓
Call inference API (streaming)
    ↓
Update PubSub (chatMessages, response)
    ↓
Save to history database
```

### Text Generation State Machine

`textGenerationStatePubSub` drives the AI response UI through these states:

| State | Description |
|-------|-------------|
| `idle` | No response yet, waiting for user input |
| `awaitingModelDownloadAllowance` | Browser inference only: waiting for user consent to download the model (when `allowAiModelDownload` is off) |
| `loadingModel` | Downloading/loading the AI model (browser inference only) |
| `awaitingSearchResults` | Waiting for search results before generating |
| `preparingToGenerate` | Search results ready, request being sent to the inference backend |
| `generating` | Streaming response tokens |
| `interrupted` | User clicked Stop; generation aborts without overwriting the partial response |
| `completed` | Full response received |
| `failed` | Error occurred during generation |

For non-browser inference types (`openai`, `internal`, `horde`), the state skips `loadingModel` and `awaitingModelDownloadAllowance`, going from `awaitingSearchResults` straight to `preparingToGenerate` then `generating` or `failed`.

### Response Throttling

Two PubSub update functions are throttled to 12 updates per second to ensure UI performance during high-frequency streaming:
- `updateResponse` &rarr; `responsePubSub`
- `updateReasoningContent` &rarr; `reasoningContentPubSub`

### Inference Backend Dispatch

When search results are ready, `searchAndRespond()` selects the inference backend based on `settings.inferenceType`:

```
settings.inferenceType
  ├── 'browser'  → generateTextWithBrowser()    [client/modules/textGenerationWithWllama.ts]
  ├── 'openai'   → generateTextWithOpenAi()     [client/modules/textGenerationWithOpenAi.ts]
  ├── 'horde'    → generateTextWithHorde()      [client/modules/textGenerationWithHorde.ts]
  └── 'internal' → generateTextWithInternalApi() [client/modules/textGenerationWithInternalApi.ts]
```

For browser inference, the system first loads the model from HuggingFace with a warmup pass, then streams tokens via the OAI-compatible `createChatCompletion` API. Each backend module implements the same contract: build context from search results + system prompt, call the inference API, stream tokens via PubSub updates.

## Conversation Memory

### Token Budget Management

- **Context Window:** 4096 tokens
- **Reserved for Response:** 25% (~1024 tokens)
- **Available for Context:** 75% (~3072 tokens)

**Allocation Priority:**
1. System prompt (with search results)
2. Conversation summary (if exists)
3. Recent chat messages (newest first)
4. Older messages (summarized or dropped)

### Rolling Summaries

When conversation exceeds token budget:

1. **Detect Overflow:** Current tokens > 3072
2. **Generate Summary:** Call LLM with 800-token limit
3. **Store Summary:** Save in conversationSummaryPubSub
4. **Drop Old Messages:** Remove summarized messages from chatMessages
5. **Continue:** Use summary + remaining messages for context

**Summary Prompt:**
```
Summarize this conversation in 3-5 sentences, preserving key facts
and user intent. Be concise but informative.
```

## Error Handling and Fallbacks

### Browser Inference Failures

Wllama handles both WebGPU and CPU paths internally. If the model fails to load or generation is interrupted, the error propagates to `textGeneration.ts`, which sets `textGenerationState` to `failed` and surfaces a retry option to the user. There is no separate fallback engine to switch to.

### API Failures

- **OpenAI:** Retry with exponential backoff, fallback to cheaper model
- **AI Horde:** Queue with timeout, retry with different model
- **Internal:** Log error, return user-friendly message

### State Recovery

If generation fails mid-stream:
1. Set `textGenerationState` to `failed`
2. Preserve partial response in `responsePubSub`
3. Allow user to retry or modify query

## Performance Optimization

### Model Caching

Wllama model shards are cached in the browser's Origin Private File System after the first download. Subsequent loads are instant with no re-download required.

### Streaming Strategy

- Tokens streamed at 12 updates/second max (throttled)
- UI updates batched via React's automatic batching
- Web Workers used for non-blocking inference

### Progressive Model Loading

Wllama models are sharded (split into chunks):
1. Download metadata first (small, fast)
2. Download required shards progressively
3. Start inference when first shards available
4. Continue downloading remaining shards in background

## Best Practices

### For Privacy-Critical Use
- Use Browser inference (Wllama)
- Set `historyRetentionDays: 0` (no persistence)

### For Maximum Quality
- Use OpenAI GPT-4 or Internal API with large model
- Adjust temperature: 0.5-0.7 for factual, 0.8-1.0 for creative

### For Cost Efficiency
- Use AI Horde (free) or Browser inference - Wllama (one-time download)
- Limit `inferenceMaxTokens: 2048`

### For Teams/Enterprise
- Deploy Internal API with vLLM
- Set `ACCESS_KEYS` for access control
- Enable server-side logging
- Use consistent `INTERNAL_OPENAI_COMPATIBLE_API_MODEL`

## Related Topics

- **Configuration**: `docs/configuration.md` - Environment variables and settings
- **Conversation Memory**: `docs/conversation-memory.md` - Detailed token budgeting
- **UI Components**: `docs/ui-components.md` - How AI response UI works
- **Security**: `docs/security.md` - Privacy implications of each inference type
