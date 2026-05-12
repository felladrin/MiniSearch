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
All stored at `Felladrin/gguf-sharded-*` on HuggingFace:

| Model | Params | Size | Speed | Quality |
|-------|--------|------|-------|---------|
| qwen-3-0.6b | 600M | ~400MB | Fast | Good |
| smollm2-1.7b | 1.7B | ~1.1GB | Medium | Better |
| llama-3.2-1b | 1B | ~650MB | Fast | Good |
| gemma-3-1b | 1B | ~650MB | Fast | Good |
| phi-4-mini | 3.8B | ~2.2GB | Slow | Best |

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
- Limited to smaller models (3B params max due to browser memory)
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
- Streaming responses
- Auto model selection (if blank)
- Retry logic with fallback models
- Reasoning content support

**Configuration:**
```typescript
{
  inferenceType: 'openai',
  openaiApiKey: 'sk-xxx',
  openaiModel: 'gpt-4', // Optional: auto-detected if empty
  inferenceTemperature: 0.7,
  inferenceMaxTokens: 4096
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
  aiHordeApiKey: '', // Optional
  aiHordeModel: 'koboldcpp/LLaMA2-70B-Psyfighter2' // Optional
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
POST /inference
Content-Type: application/json
Authorization: Bearer <VITE_SEARCH_TOKEN>

{
  "messages": [...],
  "model": "llama-3.1-8b",
  "stream": true
}
```

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
- Disable `shareModelDownloads`
- Set `historyRetentionDays: 0` (no persistence)

### For Maximum Quality
- Use OpenAI GPT-4 or Internal API with large model
- Set `searchResultsToConsider: 5-10`
- Adjust temperature: 0.5-0.7 for factual, 0.8-1.0 for creative

### For Cost Efficiency
- Use AI Horde (free) or Browser inference - Wllama (one-time download)
- Set `searchResultsToConsider: 3` (default)
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
