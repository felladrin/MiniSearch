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
| `WLLAMA_DEFAULT_MODEL_ID` | `qwen-3-0.6b` | Default Wllama model ID (used for both WebGPU-accelerated and CPU inference) |

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

### Server Configuration

These variables control the Vite development/preview server behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Host address for the Vite server to bind to |
| `PORT` | `7860` | Port number for the main server |
| `HMR_PORT` | `7861` | Port for Hot Module Replacement during development |
| `ALLOWED_HOSTS` | `true` | Comma-separated list of allowed hostnames for the preview server |
| `BASIC_SSL` | `false` | Enable basic SSL for HTTPS support during development |

These defaults are provided by `docker-compose.yml`/`docker-compose.production.yml` (e.g. `PORT=${PORT:-7860}`), not by the application itself - `vite.config.ts` reads these variables with no fallback, so when running directly via `npm run dev`/`vite preview` without Docker, unset variables fall through to Vite's own built-in defaults.

## Application Settings

Settings are stored in browser localStorage and can be changed via the Settings UI.

### Core Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enableAiResponse` | boolean | `false` | Enable AI-generated responses for searches |
| `showEnableAiResponsePrompt` | boolean | `true` | Show prompt to enable AI response on first use |
| `enableImageSearch` | boolean | `true` | Include image results in searches |
| `enableTextSearch` | boolean | `true` | Include text results in searches |
| `searchResultsLimit` | number | `15` | Maximum search results to fetch |
| `systemPrompt` | string | (template) | Custom system prompt template for AI |
| `enterToSubmit` | boolean | `true` | Press Enter to submit query (vs Shift+Enter for new line) |
| `enableAiResponseScrolling` | boolean | `true` | Auto-scroll AI response as it generates |
| `enableNotificationOnAiComplete` | boolean | `false` | Show a browser notification when AI response generation finishes |

### Inference Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `inferenceType` | enum | `'browser'` | AI provider: `browser`, `openai`, `horde`, `internal` |
| `cpuThreads` | number | (auto) | Number of CPU threads for inference (Wllama), defaults to `navigator.hardwareConcurrency - 2` |
| `allowAiModelDownload` | boolean | `false` | Allow automatic AI model downloads |
| `wllamaModelId` | string | `VITE_WLLAMA_DEFAULT_MODEL_ID` | Default Wllama model ID |
| `hordeApiKey` | string | `'0000000000'` | AI Horde API key (default is anonymous) |
| `hordeModel` | string | `''` | Specific AI Horde model to request |
| `openAiApiBaseUrl` | string | `''` | Base URL for the OpenAI-compatible API |
| `openAiApiKey` | string | `''` | API key for the OpenAI-compatible API |
| `openAiApiModel` | string | `''` | Model identifier for the OpenAI-compatible API |
| `openAiContextLength` | number | `4096` | Context window size for OpenAI-compatible models, sent as `max_tokens` |

### Model Selection

**Wllama Models:**
- 38 pre-configured models
- Range from 135M to 4B parameters
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
| `enableHistory` | boolean | `true` | Enable search history persistence |
| `historyRetentionDays` | number | `30` | Days to keep search history |
| `historyMaxEntries` | number | `1000` | Maximum history entries before cleanup |
| `historyAutoCleanup` | boolean | `true` | Automatically clean old history entries |
| `historyGroupByDate` | boolean | `true` | Group history entries by date in UI |

### System Prompt Configuration

The default system prompt supports template placeholders populated at runtime:

```typescript
{
  systemPrompt: `Answer using the search results below as your primary source, supplemented by your own knowledge when needed. Write your response in the same language as the query.

Cite every fact taken from the search results with an inline Markdown link immediately after it. Format: [domain.com](https://full-url). Use only the top-level domain (no https://, www., or paths) as link text. Example: [youtube.com](https://www.youtube.com/watch?v=dQw4w9WgXcQ).

When the search results disagree with each other, point out the conflict. When you rely on your own knowledge because the results don't cover something, make that clear rather than presenting it as sourced.

Today's date is {{currentDate}}. Use it to resolve relative date references in both the question and the results.

You are allowed to use these Markdown elements: anchor, bold, italic, code, quote, table.

Search results:

{{searchResults}}`,
  reasoningStartMarker: '<think>',
  reasoningEndMarker: '</think>'
}
```

**Placeholders:**
- `{{currentDate}}`: Current date injected at generation time
- `{{dateTime}}`: Alias for `{{currentDate}}` - both are replaced with the same current date value
- `{{searchResults}}`: Formatted search results from the web search

**Reasoning Markers:** Models that output internal thought processes use `<think>` and `</think>` markers. The UI extracts and separately displays reasoning content from the final response.

### Privacy Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `selectedVoiceId` | string | `""` | Voice ID for text-to-speech |
| `reasoningStartMarker` | string | `"<think>"` | Marker for start of reasoning content |
| `reasoningEndMarker` | string | `"</think>"` | Marker for end of reasoning content |

## Docker Configuration

### docker-compose.yml (Development)

```yaml
services:
  development-server:
    environment:
      - HOST=${HOST:-0.0.0.0}
      - PORT=${PORT:-7860}
      - BASIC_SSL=${BASIC_SSL:-false}
      - HMR_PORT=${HMR_PORT:-7861}
    ports:
      - "${PORT:-7860}:7860"
      - "${HMR_PORT:-7861}:7861"
    build:
      dockerfile: Dockerfile
      context: .
    volumes:
      - .:/home/node/app/  # Live code mounting
    command:
      [
        "(cd /usr/local/searxng/searxng-src && /usr/local/searxng/searxng-venv/bin/python -m searx.webapp > /tmp/searxng.log 2>&1) & (npm install && npm run dev)",
      ]
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

The app runs under the `node` user, with the app directory at `/home/node/app`. The production image starts the app with `npm start -- --host` (i.e. `vite preview`), not `npm run dev`.

**Multi-service container** runs all three concurrently via shell process composition.

## Vite Environment Injection

Environment variables are loaded via `dotenv` at application startup and injected at build time via `vite.config.ts` using Vite's `define` feature. Variables are replaced at build time with their actual values, appearing as global constants in the client code.

### Injected Constants

| Constant | Source | Description |
|----------|--------|-------------|
| `VITE_SEARCH_TOKEN` | Generated at build time | CSRF protection token |
| `VITE_ACCESS_KEYS_ENABLED` | `ACCESS_KEYS` | Boolean indicating if access control is active |
| `VITE_ACCESS_KEY_TIMEOUT_HOURS` | `ACCESS_KEY_TIMEOUT_HOURS` | Hours to cache validated access keys |
| `VITE_WLLAMA_DEFAULT_MODEL_ID` | `WLLAMA_DEFAULT_MODEL_ID` | Default Wllama model identifier |
| `VITE_INTERNAL_API_ENABLED` | `INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL` | Boolean indicating if internal API is configured |
| `VITE_DEFAULT_INFERENCE_TYPE` | `DEFAULT_INFERENCE_TYPE` | Default AI provider |
| `VITE_INTERNAL_API_NAME` | `INTERNAL_OPENAI_COMPATIBLE_API_NAME` | Display name for internal API |

### Build-Time Metadata

These constants are generated during the build process:

| Constant | Description |
|----------|-------------|
| `VITE_BUILD_DATE_TIME` | ISO timestamp of when the build occurred |
| `VITE_COMMIT_SHORT_HASH` | Git commit hash at build time (if available) |

These are accessed in client code as:
```typescript
const token = import.meta.env.VITE_SEARCH_TOKEN;
const buildDate = import.meta.env.VITE_BUILD_DATE_TIME;
```

### Security Considerations

- Variables with `VITE_` prefix are bundled into the client JavaScript and visible in browser dev tools
- Non-prefixed variables remain server-side only (e.g., `INTERNAL_OPENAI_COMPATIBLE_API_KEY` is NOT injected)
- The search token is hashed client-side before transmission; the raw token is never sent over the network

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
# Users choose the Wllama model in settings (WebGPU used automatically when available)
# Models download to user's browser (no server AI)
```

## Debugging Configuration

MiniSearch logs internal events to an in-app log panel (see the Logs section of the menu), backed by `logEntriesPubSub` in `client/modules/logEntries.ts`. There is no separate browser-console debug flag to enable.

**Diagnosing empty search results:** if a search returns no results, the client only sees a generic failure. The actual reason is printed to the server's console (via `server/webSearchService.ts`, always-on `debug` logging), either the SearXNG engines that failed (timeouts, suspensions, rate limits, from SearXNG's `unresponsive_engines` field) or a note that all returned results were discarded during processing (missing title, snippet, or media source). Check the server logs (`docker compose logs`) when troubleshooting failed searches.

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
