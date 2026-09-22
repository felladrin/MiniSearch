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
| `WLLAMA_DEFAULT_MODEL_ID` | `littlelamb-290m` | Default Wllama model ID (used for both WebGPU-accelerated and CPU inference) |

### Server Model Request Configuration

The server-side model request defaults can be adjusted at runtime with these
optional environment variables. Integer values are parsed as decimal numbers,
and temperature and top-p values are parsed as floating-point numbers. An empty
value uses the corresponding default.

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_MAX_RETRIES` | `5` | Maximum number of retries for a model request |
| `MODEL_BASE_BACKOFF_MS` | `100` | Initial retry backoff in milliseconds |
| `MODEL_MAX_BACKOFF_MS` | `5000` | Maximum retry backoff in milliseconds |
| `MODEL_REQUEST_TIMEOUT_MS` | `30000` | Model request timeout in milliseconds |
| `MODEL_MAX_CONCURRENT_REQUESTS` | `10` | Maximum number of simultaneous model requests |
| `MODEL_DEFAULT_MAX_TOKENS` | `2048` | Default maximum number of generated tokens |
| `MODEL_TEMPERATURE` | `0.7` | Model sampling temperature |
| `MODEL_TOP_P` | `0.9` | Model nucleus-sampling probability |

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
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For`/`X-Real-IP` for the per-client rate-limit key. Enable **only** behind a reverse proxy that sets the rightmost `X-Forwarded-For` entry. Leave off when the instance is exposed directly - otherwise clients could forge the header to evade rate limiting. |

These defaults are provided by `docker-compose.yml`/`docker-compose.production.yml` (e.g. `PORT=${PORT:-7860}`), not by the application itself - `vite.config.ts` reads these variables with no fallback, so when running directly via `npm run dev`/`vite preview` without Docker, unset variables fall through to Vite's own built-in defaults.

### Dictation

| Variable | Default | Description |
|----------|---------|-------------|
| `DICTATION_MODELS_DIR` | `<system temp>/minisearch-dictation-models` | Directory where the server caches the speech-to-text model files it serves under `/dictation-models/`. The files are fetched once from the pinned upstream URL on the first request, verified against a pinned SHA-256, and reused after that. They land in a subdirectory named after the model release, so a later release cannot be served from an older cache. The default lives under the system temp directory, so a container re-downloads ~51 MB after a restart unless this points at a volume |

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
| `enablePageContentFetch` | boolean | `true` | Read the pages behind the top results and ground the answer on their text instead of on snippets alone. |

### Inference Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `inferenceType` | enum | `'browser'` | AI provider: `browser`, `openai`, `horde`, `internal` |
| `cpuThreads` | number | (auto) | Number of CPU threads for inference (Wllama), defaults to half the logical processors (`navigator.hardwareConcurrency / 2`), minimum 1 |
| `allowAiModelDownload` | boolean | `false` | Allow automatic AI model downloads |
| `wllamaModelId` | string | `WLLAMA_DEFAULT_MODEL_ID` env var | Default Wllama model ID |
| `hordeApiKey` | string | `'0000000000'` | AI Horde API key (default is anonymous) |
| `hordeModel` | string | `''` | Specific AI Horde model to request |
| `openAiApiBaseUrl` | string | `''` | Base URL for the OpenAI-compatible API |
| `openAiApiKey` | string | `''` | API key for the OpenAI-compatible API |
| `openAiApiModel` | string | `''` | Model identifier for the OpenAI-compatible API |
| `openAiContextLength` | number | `4096` | Context window size for OpenAI-compatible models, sent as `max_tokens` |

### Model Selection

**Wllama Models:**
- 30+ pre-configured models
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
- `{{searchResults}}`: Formatted search results from the web search, including the page excerpts when `enablePageContentFetch` is on

**Reasoning Markers:** Models that output internal thought processes use `<think>` and `</think>` markers. The UI extracts and separately displays reasoning content from the final response.

### Privacy Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `selectedVoiceId` | string | `""` | Voice for reading answers aloud. `piper:<voice>` picks a local neural voice, `system:<voiceURI>` an OS voice, and `""` picks one automatically for the browser language. The Voice settings panel lists only the voices of the selected engine, and switching that engine resets this to `""`. A bare value stored by an earlier version is read as an OS voice whenever the system engine runs; with the local engine it is ignored in favor of a language match |
| `textToSpeechEngine` | `"local" \| "system"` | `"local"` | Which engine reads answers aloud, and which set of voices the Voice settings panel lists. `"system"` also overrides a local voice picked above, and stops the voice list from being fetched, so it never contacts a third-party host. A profile that had picked an OS voice before this setting existed starts on `"system"`, so the upgrade does not replace that choice with a model download |
| `enableDictation` | boolean | `true` | Shows the Dictate button that fills the search field while the user speaks. Turning this off hides the button and loads nothing. The button is also hidden outside a secure context, so an instance served over plain HTTP on a LAN will not show it: no browser grants microphone access there |
| `enableLocalDictationModel` | boolean | `true` only when the browser's primary language is English | Whether the Dictate button prefers the on-device Moonshine model, which understands English only. With it off, the button uses the browser's built-in `SpeechRecognition`, which handles other languages but may send the audio to the browser vendor. The preference reorders the two engines and never removes one: on browsers without `SpeechRecognition` the on-device model is used regardless. The default is derived from `navigator.language` at first load, so a non-English browser starts on the built-in recognizer with no model download; the Voice settings panel can flip it either way |
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

The Dockerfile sets up a single runtime stage:
   - Node.js LTS
   - Python 3 + SearXNG

The app runs under the `node` user, with the app directory at `/home/node/app`. The production image starts the app with `npm start -- --host` (i.e. `vite preview`), not `npm run dev`.

**Multi-service container** runs SearXNG and Node.js concurrently via shell process composition.

### Nothing Is Configured at Build Time

The Dockerfile declares no `ARG` for any of the settings above, and
`.dockerignore` excludes `.env` files from the build context. Both are
deliberate: build args are recorded in `docker history`, and a copied `.env`
becomes a readable image layer, so either one would publish `ACCESS_KEYS` and
`INTERNAL_OPENAI_COMPATIBLE_API_KEY` to anyone who pulls the image.

Pass configuration when you start the container, via `docker run -e`, the
`environment:` block in a compose file, or a secret manager. Building your own
image with `--build-arg ACCESS_KEYS=...` has no effect, and neither does
relying on a local `.env` being baked in; without runtime values the app falls
back to the `.env.example` defaults. See
[Runtime Configuration](#runtime-configuration) for how those values reach the
client.

## Tuning the Search Engines

The bundled SearXNG instance decides which engines answer a query. MiniSearch ships a thin overlay for it (`searxng-settings.yml`) that declares two things: the JSON output format that `server/webSearchService.ts` consumes, and a `secret_key` that the Dockerfile rewrites with a random value at build time. Everything else about the engine list comes from the pinned SearXNG build, so read the set from the running instance rather than from this page: the command below shows which engines answered and which came back unresponsive. Whatever that set turns out to be, one engine that is rate-limited or CAPTCHA-challenged from your server's IP thins every result page, because the other engines have to carry the query on their own.

Diagnose before you change anything. `/status` needs no token and publishes `searches.unresponsiveEngines`, each engine classified `blocked`, `timeout` or `other`, and the server log prints the same names through the always-on `debug` in `server/webSearchService.ts`. See [Debugging Configuration](#debugging-configuration). To see the engine set itself, ask SearXNG directly, with the same parameters the app sends:

```bash
docker exec <container> /usr/local/searxng/searxng-venv/bin/python -c "
import json, urllib.request
from collections import Counter
url = ('http://127.0.0.1:8888/search?q=hiking+near+lisbon&format=json'
       '&categories=general&lang=auto&safesearch=1')
data = json.load(urllib.request.urlopen(url, timeout=60))
print(len(data.get('results', [])), dict(Counter(r.get('engine') for r in data.get('results', []))))
print('unresponsive:', data.get('unresponsive_engines'))
"
```

Image search asks for `categories=images,videos` instead, and the same switches below apply to the image engines.

SearXNG reads its settings when the container starts, so you can replace that file without rebuilding the image. It looks at `SEARXNG_SETTINGS_PATH` first and at `/etc/searxng/settings.yml` otherwise. A `SEARXNG_SETTINGS_PATH` that points at a file which is not there is a hard failure rather than a fallthrough: SearXNG exits with `EnvironmentError: <path> not exists!`. Prefer that variable, because it leaves the image's own file untouched and lets your file be mounted read-only.

The name is also a build `ARG` in the Dockerfile, where it only selects where the overlay is copied. A build arg does not survive into the container environment, so `--build-arg SEARXNG_SETTINGS_PATH=...` changes nothing at runtime; it only picks where the overlay is copied during the build.

Two switches turn engines on, and they are not interchangeable: `disabled: false` is for an engine that ships `disabled: true`, and `inactive: false` is for one that ships `inactive: true`. Which one a given engine needs is written in the pinned upstream settings file inside the container:

```bash
docker exec <container> grep -A8 -E '^  - name: (mojeek|startpage|google)$' /usr/local/searxng/searxng-src/searx/settings.yml
```

Setting the other one fails silently. An engine left `inactive` is never loaded, and one left `disabled` is loaded but never queried, so it simply never shows up in results and nothing reports why. Both switches were measured against the published image: with `google` set to `disabled: false` it contributed 10 of the results in that run, and with `mojeek` set to `inactive: false` it contributed 9 in another. The run totals are further down this section.

```yaml
# my-searxng-settings.yml
use_default_settings: true

server:
  secret_key: "<your own random value>"

search:
  formats:
    - json

engines:
  - name: mojeek
    inactive: false
  - name: google
    disabled: false
```

`use_default_settings: true` keeps the upstream engine list and merges your entries into it by engine name, and `search.formats: [json]` must stay, because it is how MiniSearch reads the response. The full vocabulary is in the [SearXNG settings docs](https://docs.searxng.org/admin/settings/settings.html).

```bash
docker run -p 7860:7860 \
  -e SEARXNG_SETTINGS_PATH=/etc/searxng-custom/settings.yml \
  -v "$(pwd)/my-searxng-settings.yml:/etc/searxng-custom/settings.yml:ro" \
  ghcr.io/felladrin/minisearch
```

The compose equivalent:

```yaml
services:
  minisearch:
    image: ghcr.io/felladrin/minisearch:latest
    ports:
      - "7860:7860"
    environment:
      - SEARXNG_SETTINGS_PATH=/etc/searxng-custom/settings.yml
    volumes:
      - ./my-searxng-settings.yml:/etc/searxng-custom/settings.yml:ro
```

Two things about that command are required, not optional:

- **The file must be readable by uid 1000.** The container runs as `node`, and a file readable only by its owner on the host is invisible to it.
- **`secret_key` must be set to your own random value.** SearXNG refuses to start on the `ultrasecretkey` placeholder and logs `server.secret_key is not changed. Please use something else instead of ultrasecretkey.` The image's own file never carries the placeholder, because the Dockerfile replaces it at build time, but a file you write has to carry a real key.

A SearXNG startup failure will not show in `docker logs`. The container's CMD sends SearXNG's output to `/dev/null`, deliberately, so that the app server's log stays clean. To see it, run SearXNG in the foreground inside the container, which is only possible once the original has failed: on a running instance the second process collides with the live one on `127.0.0.1:8888` and reports the address as already in use.

```bash
docker exec <container> sh -c 'cd /usr/local/searxng/searxng-src && /usr/local/searxng/searxng-venv/bin/python -m searx.webapp'
```

To check the override took effect, print the flags of the engines you changed. Printing the names proves nothing, because every engine name is in the upstream list whether or not your entry was applied:

```bash
docker exec <container> /usr/local/searxng/searxng-venv/bin/python -c "
import searx.settings_loader as sl
settings, source = sl.load_settings()
print(source)
print([(e['name'], e.get('disabled'), e.get('inactive'))
       for e in settings['engines'] if e['name'] in ('mojeek', 'google')])
"
```

Then run the query command from the top of this section again and compare which engines answered. In a run against the published image on 2026-09-22, the default settings returned 24 results for one query, all from `brave`, with `duckduckgo` reported CAPTCHA and `google cse` reported as crashed. The same query with `mojeek` switched on returned 42 results across `brave`, `mojeek` and `google cse`, and a third run with `google` switched on returned 40 across `google`, `brave` and `google cse`. Treat those as measurements of one host on one day: which engines answer depends on your IP and on the hour, and `google cse` came back on its own between the first run and the second.

Engine choice does not change the privacy posture. SearXNG still makes the request, from your server's address, so the engine sees the instance and not the user, and no query goes to any third party that SearXNG did not already talk to.

None of this reaches MiniSearch's code. The app asks SearXNG for one JSON document and reranks whatever comes back, so nothing in `server/webSearchService.ts` changes when you retune the engines, and the circuit breaker, the retries and the `unresponsive_engines` reporting keep working over the new set.

## Runtime Configuration

Client-facing configuration (access keys, inference type, internal API settings) is resolved at runtime via the `/api/config` endpoint. The client fetches this endpoint on app initialization, so the published Docker image is fully configurable via environment variables at runtime - no rebuild needed.

### `/api/config` Response

```json
{
  "accessKeysEnabled": true,
  "accessKeyTimeoutHours": 24,
  "wllamaDefaultModelId": "littlelamb-290m",
  "internalApiEnabled": true,
  "internalApiName": "Internal API",
  "defaultInferenceType": "browser",
  "searchToken": "<search-token>"
}
```

### Build-Time vs Runtime Configuration

| Value | Resolved At | Notes |
|-------|-------------|-------|
| `VITE_BUILD_DATE_TIME` | Build time | Epoch milliseconds when the build occurred |
| `VITE_COMMIT_SHORT_HASH` | Build time | Git commit hash at build time (if available) |
| `ACCESS_KEYS` | Runtime | Read from `/api/config` |
| `ACCESS_KEY_TIMEOUT_HOURS` | Runtime | Read from `/api/config` |
| `WLLAMA_DEFAULT_MODEL_ID` | Runtime | Read from `/api/config` |
| `INTERNAL_OPENAI_COMPATIBLE_API_*` | Runtime | Read from `/api/config` (except `API_KEY` which is server-only) |
| `DEFAULT_INFERENCE_TYPE` | Runtime | Read from `/api/config` |
| Search token | Runtime | Read from `/api/config`, so a reload picks up the token of whichever server answers |

### Security Considerations

- `VITE_BUILD_DATE_TIME` and `VITE_COMMIT_SHORT_HASH` are bundled into the client JavaScript as build-time constants (build metadata only)
- The CSRF token is served at runtime like the rest of the config. It reaches any caller that can reach `/api/config`, which is the same exposure it had while it was compiled into the bundle
- All other configuration is fetched at runtime from `/api/config` and never appears in the bundled JavaScript
- Server-only variables like `INTERNAL_OPENAI_COMPATIBLE_API_KEY` are never exposed to the client

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

**Diagnosing empty search results:** the client distinguishes a search that returned no results (a no-results alert, state stays `completed`) from one that failed outright on an outage (a distinct failed state, with a retry on text searches). An empty response that names unresponsive engines is retried within the same budget as a 500 and counts as the second if it is still empty when the retries are spent, since a rate-limited, suspended or CAPTCHA-challenged engine is reported that way and not with a status code. The actual reason is printed to the server's console (via `server/webSearchService.ts`, always-on `debug` logging), either the SearXNG engines that failed (timeouts, suspensions, rate limits, from SearXNG's `unresponsive_engines` field) or a note that all returned results were discarded during processing (missing title, snippet, or media source). Check the server logs (`docker compose logs`) when troubleshooting failed searches.

Check effective configuration:
```typescript
// In browser console
console.log('Settings:', JSON.parse(localStorage.getItem('settings') || '{}'));
console.log('Server config:', await fetch('/api/config').then(r => r.json()));
```

## Related Topics

- **AI Integration**: `docs/ai-integration.md` - Detailed inference type configuration
- **Security**: `docs/security.md` - Access control and privacy details
- **Deployment**: `docs/overview.md` - Container architecture and production setup
