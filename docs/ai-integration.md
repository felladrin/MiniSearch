# AI Integration

MiniSearch supports four AI inference backends, each with different trade-offs between privacy, performance, and setup complexity.

## Inference Types Overview

| Type | Privacy | Speed | Setup | Best For |
|------|---------|-------|-------|----------|
| **Browser** (WebLLM/Wllama) | Maximum (no data leaves device) | Fast (WebGPU) / Slow (CPU) | None | Personal use, privacy-critical scenarios |
| **OpenAI** | Low (data sent to OpenAI) | Very Fast | API Key | Maximum quality, convenience |
| **AI Horde** | Medium (distributed volunteers) | Variable | Anonymous | Free GPU access, no setup |
| **Internal** | High (your infrastructure) | Depends on hardware | Self-hosted API | Teams, compliance requirements |

## Browser-Based Inference

Runs AI models entirely in the browser using WebAssembly or WebGPU. No data leaves the user's device.

### WebLLM (WebGPU Accelerated)

Uses `@mlc-ai/web-llm` for GPU-accelerated inference.

**Requirements:**
- Modern browser with WebGPU support (Chrome 113+, Edge 113+, Firefox Nightly)
- ~500MB-2GB free RAM
- GPU with F16 shader support (for optimal models)

**How It Works:**
1. User searches with "Enable AI Response" on
2. Library checks WebGPU availability and F16 shader support
3. Downloads model weights from HuggingFace (cached in IndexedDB)
4. Loads model into GPU memory
5. Generates response streaming tokens

**Model Selection:**
```typescript
// WebLLM model IDs from MLC registry
const models = {
  fast: 'Qwen3-0.6B-q4f16_1-MLC',      // 600M params, ~400MB
  balanced: 'SmolLM2-1.7B-q4f16_1-MLC', // 1.7B params, ~1GB
  capable: 'Llama-3.2-1B-q4f16_1-MLC'   // 1B params, ~600MB
};
```

**Configuration:**
- Settings → Inference Type: `Browser`
- Settings → Browser Model: Select from dropdown
- Settings → Enable WebGPU: Toggle (auto-detected)

**Limitations:**
- First load requires model download (progressive via sharded files)
- Limited to smaller models (3B params max due to browser memory)
- Requires modern browser with WebGPU

### Wllama (CPU-Based)

Uses `@wllama/wllama` for CPU inference via WebAssembly.

**Requirements:**
- Any modern browser
- ~300MB-1GB free RAM
- No WebGPU required

**How It Works:**
1. Downloads model from HuggingFace (GGUF format)
2. Runs inference in WebAssembly (slower but universally compatible)
3. Supports 40+ pre-configured models

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
- Settings → Use WebGPU: OFF
- Settings → Wllama Model: Select from dropdown

**Limitations:**
- Slower than WebGPU (2-5x slower)
- Same memory constraints
- No GPU acceleration

### WebLLM vs Wllama Decision Matrix

```
WebGPU Available?
├── Yes → WebLLM (F16 if supported, else F32)
└── No  → Wllama (CPU inference)
```

**Code Detection:**
```typescript
// client/modules/webGpu.ts
export async function isWebGpuAvailable(): Promise<boolean> {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export async function isF16ShaderSupported(): Promise<boolean> {
  const adapter = await navigator.gpu?.requestAdapter();
  return adapter?.features.has('shader-f16') ?? false;
}
```

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

```typescript
// If WebLLM fails, fallback to Wllama
try {
  await generateWithWebLLM();
} catch (error) {
  if (error.message.includes('WebGPU')) {
    // Auto-switch to Wllama
    settings.enableWebGpu = false;
    await generateWithWllama();
  }
}
```

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

All browser-based models cached in IndexedDB:
- WebLLM: `webllm/model-cache`
- Wllama: `wllama/model-cache`
- Subsequent loads: Instant (no re-download)

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
- Use Browser inference (WebLLM/Wllama)
- Disable `shareModelDownloads`
- Set `historyRetentionDays: 0` (no persistence)

### For Maximum Quality
- Use OpenAI GPT-4 or Internal API with large model
- Set `searchResultsToConsider: 5-10`
- Adjust temperature: 0.5-0.7 for factual, 0.8-1.0 for creative

### For Cost Efficiency
- Use AI Horde (free) or Browser inference (one-time download)
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
