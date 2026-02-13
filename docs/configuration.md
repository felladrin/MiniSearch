# Configuration

## Environment Variables

All configuration is done via environment variables. Create a `.env` file in the project root.

### Access Control

| Variable | Default | Description |
|----------|---------|-------------|
| `ACCESS_KEYS` | `''` | Comma-separated list of valid access keys (e.g., `'key1,key2,key3'`) |
| `ACCESS_KEY_TIMEOUT_HOURS` | `24` | Hours to cache validated keys in browser. Set to `0` to require validation on every request |

**Example:**
```bash
ACCESS_KEYS="my-secret-key-1,my-secret-key-2"
ACCESS_KEY_TIMEOUT_HOURS="24"
```

### AI Model Defaults

Configure default models for different inference types:

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBLLM_DEFAULT_F16_MODEL_ID` | `Qwen3-0.6B-q4f16_1-MLC` | Default WebLLM model with F16 shaders (requires WebGPU) |
| `WEBLLM_DEFAULT_F32_MODEL_ID` | `Qwen3-0.6B-q4f32_1-MLC` | Default WebLLM model with F32 shaders (CPU fallback) |
| `WLLAMA_DEFAULT_MODEL_ID` | `qwen-3-0.6b` | Default Wllama model (CPU-based, no WebGPU required) |

**Model Selection Notes:**
- F16 models are faster but require WebGPU with F16 shader support
- F32 models work on all WebGPU-capable devices
- Wllama models run on CPU via WebAssembly (slower but most compatible)

### Internal API Configuration

For self-hosted OpenAI-compatible APIs:

| Variable | Default | Description |
|----------|---------|-------------|
| `INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL` | `''` | Base URL of your API (e.g., `https://api.internal.company.com/v1`) |
| `INTERNAL_OPENAI_COMPATIBLE_API_KEY` | `''` | API key for authentication |
| `INTERNAL_OPENAI_COMPATIBLE_API_MODEL` | `''` | Model ID to use (auto-detected if empty) |
| `INTERNAL_OPENAI_COMPATIBLE_API_NAME` | `Internal API` | Display name shown in UI |

**Example:**
```bash
INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL="https://llm.internal.company.com/v1"
INTERNAL_OPENAI_COMPATIBLE_API_KEY="sk-internal-xxx"
INTERNAL_OPENAI_COMPATIBLE_API_MODEL="llama-3.1-8b"
INTERNAL_OPENAI_COMPATIBLE_API_NAME="Company LLM"
```

### Default Behavior

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_INFERENCE_TYPE` | `browser` | Default AI inference type (`browser`, `openai`, `horde`, `internal`) |

## Application Settings

Settings are stored in browser localStorage and can be changed via the Settings UI.

### Core Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enableAiResponse` | boolean | `false` | Enable AI-generated responses for searches |
| `enableWebGpu` | boolean | `true` | Use WebGPU acceleration when available |
| `enableImageSearch` | boolean | `true` | Include image results in searches |
| `searchResultsToConsider` | number | `3` | Number of top search results to include in AI context |
| `searchResultsLimit` | number | `15` | Maximum search results to fetch |
| `systemPrompt` | string | (template) | Custom system prompt template for AI |

### Inference Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `inferenceType` | enum | `'browser'` | AI provider: `browser`, `openai`, `horde`, `internal` |
| `inferenceTemperature` | number | `0.7` | Sampling temperature (0.0-1.0) |
| `inferenceTopP` | number | `0.9` | Nucleus sampling parameter |
| `inferenceMaxTokens` | number | `4096` | Maximum tokens per generation |
| `inferenceTopK` | number | `40` | Top-K sampling parameter (browser only) |
| `minP` | number | `0.1` | Min-p sampling threshold |
| `repeatPenalty` | number | `1.1` | Penalty for token repetition |

### Model Selection

**WebLLM Models:**
- Uses MLC LLM model registry
- Models loaded from HuggingFace
- Common options: `Qwen3-0.6B`, `SmolLM2-1.7B`, `Llama-3.2-1B`

**Wllama Models:**
- 40+ pre-configured models
- Range from 135M to 3.8B parameters
- All quantized to Q4_K_S or UD-Q4_K_XL
- Stored at: `Felladrin/gguf-sharded-*` on HuggingFace

**OpenAI/Internal:**
- Any OpenAI-compatible API
- Auto-model detection if not specified
- Supports streaming and reasoning models

**AI Horde:**
- Uses aihorde.net distributed network
- Anonymous or authenticated access
- Parallel generation with race conditions

### History Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `historyRetentionDays` | number | `30` | Days to keep search history |
| `historyMaxEntries` | number | `1000` | Maximum history entries before cleanup |
| `enableHistorySync` | boolean | `true` | Save history to IndexedDB |

### Privacy Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enableTelemetry` | boolean | `false` | Enable anonymous usage analytics |
| `shareModelDownloads` | boolean | `true` | Share model downloads via WebRTC (peer-to-peer) |

## Docker Configuration

### docker-compose.yml (Development)

```yaml
services:
  development-server:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "7861:7860"  # App
      - "8888:8888"  # SearXNG
    environment:
      - ACCESS_KEYS=${ACCESS_KEYS:-}
      - ACCESS_KEY_TIMEOUT_HOURS=${ACCESS_KEY_TIMEOUT_HOURS:-24}
      - WEBLLM_DEFAULT_F16_MODEL_ID=${WEBLLM_DEFAULT_F16_MODEL_ID:-Qwen3-0.6B-q4f16_1-MLC}
      # ... more env vars
    volumes:
      - .:/home/user/app  # Live code mounting
      - /home/user/app/node_modules
```

### docker-compose.production.yml

Same structure but without volume mounts and with pre-built assets.

### Dockerfile Environment

The Dockerfile sets up:
1. **Builder stage**: Compiles `llama-server` from llama.cpp
2. **Runtime stage**: 
   - Node.js LTS
   - Python 3 + SearXNG
   - llama-server binary

**Multi-service container** runs all three concurrently via shell process composition.

## Vite Environment Injection

Environment variables are injected at build time via `vite.config.ts`:

```typescript
// Injected into import.meta.env
VITE_SEARCH_TOKEN
VITE_ACCESS_KEYS_ENABLED
VITE_WEBLLM_DEFAULT_F16_MODEL_ID
VITE_WEBLLM_DEFAULT_F32_MODEL_ID
VITE_WLLAMA_DEFAULT_MODEL_ID
VITE_INTERNAL_API_ENABLED
VITE_DEFAULT_INFERENCE_TYPE
```

These are accessed in client code as:
```typescript
const token = import.meta.env.VITE_SEARCH_TOKEN;
```

## Configuration Patterns

### Scenario: Private Team Instance

```bash
# .env
ACCESS_KEYS="team-alpha-2024,team-beta-2024"
ACCESS_KEY_TIMEOUT_HOURS="8"
DEFAULT_INFERENCE_TYPE="internal"
INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL="https://llm.company.com/v1"
INTERNAL_OPENAI_COMPATIBLE_API_KEY="sk-xxx"
INTERNAL_OPENAI_COMPATIBLE_API_MODEL="llama-3.1-70b"
```

### Scenario: Public Demo (No AI)

```bash
# .env - empty, no access keys
# AI disabled by default in settings
```

### Scenario: Browser-Only AI

```bash
# .env - minimal or empty
# Users choose WebLLM or Wllama in settings
# Models download to user's browser (no server AI)
```

## Debugging Configuration

Enable verbose logging:
```bash
# In browser console
localStorage.setItem('debug', 'minisearch:*');
```

Check effective configuration:
```typescript
// In browser console
console.log('Settings:', JSON.parse(localStorage.getItem('settings') || '{}'));
console.log('Env:', import.meta.env);
```

## Related Topics

- **AI Integration**: `docs/ai-integration.md` - Detailed inference type configuration
- **Security**: `docs/security.md` - Access control and privacy details
- **Deployment**: `docs/overview.md` - Container architecture and production setup
