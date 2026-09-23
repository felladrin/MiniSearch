# Security

## Access Control

- **Optional Access Keys**: `ACCESS_KEYS` environment variable for usage restriction
- **Rate Limiting**: Applied to search and inference endpoints
- **Server-side Validation**: Access keys verified before proxying to SearXNG
- **Key Timeout**: `ACCESS_KEY_TIMEOUT_HOURS` controls cache duration

### Access Key Validation Flow

1. User enters access key on the **AccessPage** UI
2. Client hashes the key client-side using argon2id with fixed parameters (`m=512, t=16, p=1`)
3. Server validates the hash against configured `ACCESS_KEYS` via `validateAccessKeyServerHook`. The hash's prefix (`$argon2id$v=19$m=512,t=16,p=1$`) is checked before `argon2Verify` runs, so a caller cannot embed inflated parameters to force allocations per configured key.
4. On success: key hash is stored in localStorage with timestamp
5. On subsequent loads, `useAccessKeyValidation` in `App.tsx` calls `verifyStoredAccessKey()` to check if the cached key is still valid
6. If expired (based on `ACCESS_KEY_TIMEOUT_HOURS`), user is prompted to re-enter

Whether access keys are enabled is read at runtime from `/api/config`. When that
request fails, the app shell refuses to render rather than assuming access keys
are off, so a request that never arrives cannot skip the access key page.

### `/api/config` Exposure

`/api/config` is unauthenticated by design: the client needs it before it can
prove anything, and the access key page itself depends on it. It returns only
whether a feature is on plus its display defaults, and never returns
`ACCESS_KEYS`, `INTERNAL_OPENAI_COMPATIBLE_API_KEY`, or any other secret. Adding
a field to `ServerConfig` in `shared/serverConfig.ts` publishes it to anyone who
can reach the instance, so keep secrets out of that interface.

### Search Token Lifecycle

Every HTTP request from client to backend carries a `token` query parameter for CSRF protection:

1. **Token Generation**: On first use in a process, `regenerateSearchToken()` draws 32 random bytes and writes them to `{os.tempdir()}/minisearch-token` with `0600`. The file is never read back as a source of truth: a token that survives into a published image is one every container of that build shares, and anyone who pulls the image can read it out of the layer
2. **Client Distribution**: The server holds the token it generated for the life of the process and serves it as `searchToken` in `/api/config`. Each process generates its own, so a restart or a second instance means a new token, which is why a bookmarked or shared search URL stops working and lands on the expired-link page
3. **Per-Request Auth**: Client includes token as `?token=` parameter on all `/search/text`, `/search/images`, `/page-content`, `/thumbnail` and `/inference` requests
4. **Server Verification**: `handleTokenVerification()` in `handleTokenVerification.ts` validates the token before proxying to SearXNG. The token hash's prefix (`$argon2id$v=19$m=512,t=16,p=1$`) is checked before `argon2Verify` runs, so a caller cannot embed inflated parameters to force multi-gigabyte allocations or excessive CPU work.
5. **Session Tracking**: Validated tokens are stored in an in-memory `Set<string>` (`verifiedTokens.ts`) for session counting
6. **Rejection Caching**: Tokens that fail a completed verification are kept in a bounded in-memory set (`rejectedTokens.ts`) until it evicts them at the cap, so a replay is refused without paying for a second argon2 verification; a token whose verification threw instead of returning a result, whether from an unparseable hash or an unreadable token file, is refused without taking a slot; how many rejections were served that way is reported on `/status` (`authorization.rejectedTokenCacheHits`)

## Privacy

- **Local-First Storage**: All data stored in IndexedDB, no cloud sync
- **No Tracking**: No telemetry, analytics, or user tracking
- **SearXNG Integration**: All web searches routed through privacy-focused metasearch
- **Browser-Only Mode Still Downloads Models From HuggingFace**: The instance sends no telemetry and no analytics. But browser-only mode is not fully offline: both wllama and the local text-to-speech engine fetch their models from `huggingface.co` (served from `us.aws.cdn.hf.co`), so that host sees the user's IP. The text-to-speech engine's full host list is in the Reading Answers Aloud bullet below.
- **Page Reading Is On By Default, And Reversible**: `enablePageContentFetch` ships on and the user can turn it off under AI Settings; nothing is read until AI responses are enabled, and the server (never the browser) requests the top result pages, so those sites see the instance and no user cookies or IP
- **Search And Page Reading Leave No Query In The Log**: The search query is never written to the server log, and neither is the URL of a page read for grounding; how often searches come back empty, fail on unresponsive engines or are fully discarded, and how page reads ended, are counted instead and reported on `/status` (`searchesWithoutResults`, `searchesWithUnresponsiveEngines`, `searchesWithAllResultsDiscarded`, `pageReads`). `searches.unresponsiveEngines` names the engines behind those failures, which is configured infrastructure rather than anything a user typed, the same basis on which `inference.byModel` names model ids. What each failed with is published as one of `blocked`, `timeout` or `other`, never SearXNG's own wording: `/status` needs no token, and an upstream engine is free to build its error text out of the request URL, and so out of the query. The raw string stays in the server log and in the thrown error the search endpoint catches; the 502 it answers with carries a fixed message, so the string never leaves the server. The page reader's per-host circuit breaker (`server/pageReadHostBreaker.ts`) holds the hosts it has boxed in memory, since it needs them to know which host to skip; a page-read host comes from the search results, downstream of the query, so unlike an engine name it is never published: `/status` reports how many reads were skipped and how often a host was boxed, as counts only. Anything in front of the instance keeps its own access log, where `?q=` appears in full

- **Dictation: Which Engine Runs, And Where The Audio Goes**: The dictation button, which sits inside the search field and inside the chat follow-up field, has two engines. The on-device engine transcribes with the Moonshine streaming model running as WebAssembly in a worker; the audio is read locally and never leaves the device, but the model understands English only. The browser engine is the browser's own `SpeechRecognition`, which handles other languages but sends audio to the browser vendor. Which one runs is decided by `enableLocalDictationModel`, and that defaults to on only when the browser's primary language is English, so a non-English browser starts on the vendor recognizer rather than on a model that cannot transcribe its user's speech. The preference reorders the engines and never removes one: on browsers without `SpeechRecognition` the on-device model runs regardless. When the preferred engine cannot run, the switch from on-device to browser happens only while the local model is on, and a notification announces it because the audio's destination changed; the reverse never happens, so a user who turned the model off never gets a surprise ~51 MB download after a recognizer failure. A denied microphone is never retried on the browser engine, since that is the user's answer rather than an engine that cannot run. Nothing loads until the button is pressed, so a user who never dictates pays nothing for the feature. The model files are served by the instance itself under `/dictation-models/` (`server/dictationModelServerHook.ts`), which only resolves a fixed whitelist of filenames for the pinned MIT-licensed English streaming model, fetches them once from `download.moonshine.ai`, and caches them on disk under `DICTATION_MODELS_DIR`; the page makes no third-party requests. The browser asks for microphone permission on the first press; a denied permission shows a notification instead of failing quietly, on either engine. On the browser engine the denial arrives after the session has started, so it is reported through the same notification rather than the press simply failing. When neither engine is available, or the page is not in a secure context, the button hides. Users can turn the feature off with `enableDictation` in the Voice settings

- **Reading Answers Aloud Contacts Third-Party Hosts**: The local text-to-speech engine fetches from outside the instance. It downloads the voice index and the model from `huggingface.co` (served from `us.aws.cdn.hf.co`), the ONNX runtime from `cdnjs.cloudflare.com` and the phonemizer from `cdn.jsdelivr.net`, because `@diffusionstudio/vits-web` hardcodes those URLs. Browser inference already downloads its models from HuggingFace, so `cdnjs.cloudflare.com` and `cdn.jsdelivr.net` are the two hosts new to this feature; unlike wllama, whose runtime is bundled with the app, this engine fetches its runtime at use time. Those hosts see the user's IP and that they used the feature. Nothing is fetched until the user presses Listen or opens the Voice settings panel with the local engine selected, and the voice model is cached in OPFS afterwards, while the index, runtime and phonemizer are fetched again on a later visit. Switching `textToSpeechEngine` to `system` avoids all of these requests, including the voice list

- **Rejections Are Counted, Not Logged**: A request turned away for a missing or invalid token, or by the rate limiter, is counted by reason and by endpoint family on `/status`; the client address the limiter keys on is never stored or reported

## Data Protection

- **Access Key Hashing**: Access keys hashed using argon2id before storage (via hash-wasm)
- **Bounded Local Result Retention**: Results are kept at most 24 hours from cache write, of which the first 15 minutes count as fresh; past that they are served only as a clearly-flagged stale fallback when the live search fails,
- **No PII Collection**: No personally identifiable information stored
- **User Control**: Users can export and delete all their data

## Supply Chain: Native & WebAssembly Modules

The full trust model lives in [`.github/SECURITY.md`](../.github/SECURITY.md) ("Native & WebAssembly Module Trust Model"); the operational parts are mirrored here.

- **Exact pins**: the native/WASM dependencies — `onnxruntime-node@1.29.0`, `@wllama/wllama@3.6.1`, `@huggingface/tokenizers@0.2.0`, `hash-wasm@4.12.0` and `@moonshine-ai/moonshine-wasm@0.1.5` — are declared with single exact versions in `package.json` (no caret ranges), and `package-lock.json` pins each tarball's SHA-512 integrity hash
- **Install-script policy**: `package.json#allowScripts` carries an explicit decision for every package in the tree that ships an install script — `onnxruntime-node` **denied** (its postinstall downloads CUDA 12 nupkgs unpacked by symlink-following `adm-zip`, GHSA-vwc7-r8mq-g2x9; both inference services run `executionProviders: ["cpu"]` and the CPU runtime ships in the tarball), `protobufjs` **denied** (its postinstall only prints a version-scheme advisory), `fsevents@2.3.3` **allowed** (the optional macOS file watcher must compile at install)
- **Strict mode**: `.npmrc` sets `strict-allow-scripts = true`, so an install script with no recorded decision fails `npm ci` instead of warning; the `.npmrc` layer itself can only allow, never deny, which is why the policy lives in `package.json`
- **CI gate**: `npm run native-module-check` (`scripts/native-module-integrity.cjs`) verifies the pins, the lockfile integrity, that every install-script-bearing package has a policy entry, and `npm audit signatures` for the tracked modules; it runs in CI next to `npm audit --audit-level=high`, which covers advisories rather than signatures and pins
- **Not verified**: registry signatures prove publisher identity and transport integrity, not benign binary semantics; and model files fetched at use time (HuggingFace, `download.moonshine.ai`, the TTS engine's CDN hosts) are outside the install-time gate — see the Privacy section above
- **Approving a new install script or bumping a pinned version**: read the script first, then `npm approve-scripts <pkg>` / `npm deny-scripts <pkg>` (writes the pinned decision into `package.json#allowScripts`) and update the decision list in `.github/SECURITY.md` in the same PR

## Security Best Practices

- Input validation on all endpoints
- Sanitization of user-generated content
- Search token generation: a per-process token generated on first use and recorded in a temp file (`server/searchToken.ts`), using 32 bytes from the `node:crypto` CSPRNG, with the file restricted to its owner (`0600`)
- HTTPS enforcement in production
- Regular dependency updates via Renovate
- **Argon2 Hashing**: Access keys hashed using argon2id for secure validation (not storage encryption)
- **Cross-Origin Isolation**: COOP/COEP headers for SharedArrayBuffer security
- **CSRF Protection**: Search tokens validated via argon2 hash comparison, over a 32-byte digest

## Server-Side Security Modules

| Module | Purpose |
|--------|---------|
| `server/searchToken.ts` | Generates the CSRF token per process and records it in `{tempdir}/minisearch-token` |
| `server/verifiedTokens.ts` | In-memory `Set<string>` of verified session tokens |
| `server/rejectedTokens.ts` | Bounded in-memory set of tokens that already failed a completed verification, so a replay skips the second argon2 check |
| `server/searchesSinceLastRestart.ts` | In-memory counters for aggregate search outcomes (text/image search totals, and how often searches came back empty or were fully discarded), plus per-engine failure counts, reported on `/status`; records no query, URL, host, or per-search timestamp, and stores a failure kind classified by `server/webSearchService.ts` rather than SearXNG's reason string |
| `server/pageReadsSinceLastRestart.ts` | In-memory aggregate counters for pages read for grounding (outcomes, durations, passage ratios), reported on `/status`; records no query, URL, host, or per-read timestamp |
| `server/pageReadHostBreaker.ts` | Per-host circuit breaker for page reads: a host that refused the last three reads is skipped for five minutes, then probed with one read; holds host names in memory only, reset on restart, and reports counts alone |
| `server/searchEndpointServerHook.ts` | Proxies text/image search to SearXNG after token verification (via `handleTokenVerification`) |
| `server/verifyTokenAndRateLimit.ts` | Verifies the Argon2 token hash and enforces rate limiting (10 requests per 10 seconds, shared by the search, page-content and inference endpoints; a separate 60-per-10-seconds budget for `/thumbnail`) |
| `server/handleTokenVerification.ts` | Middleware bridge that calls `verifyTokenAndRateLimit` and writes 400/401/429 error responses for the search, page-content, thumbnail and inference endpoints |
| `server/configEndpointServerHook.ts` | Serves the non-secret runtime config at `/api/config`, including whether access keys are enabled |
| `server/utils/publicUrl.ts` | Rejects non-HTTP schemes and hosts resolving into private, loopback, link-local or reserved ranges before the server fetches a client-supplied URL; `resolvePublicUrlAndAddress` also hands back the vetted IP so the caller can pin the connection to it |
| `server/utils/pinnedFetch.ts` | Fetches a vetted URL over a socket pinned to the vetted IP, with the original hostname preserved for TLS SNI, certificate verification and the `Host` header, so the address checked is the address reached (closes the DNS-rebinding window between check and connect) |
| `server/pageContentEndpointServerHook.ts` | Reads result pages at `/page-content` after token verification, capped at 6 URLs per request |
| `server/thumbnailEndpointServerHook.ts` | Serves one search-result thumbnail at a time at `/thumbnail` after token verification, connecting only to the vetted pinned address, with an in-process LRU in front of the upstream host |

### Server-Side Fetching of Client-Supplied URLs

`/page-content` is the endpoint that fetches a URL the client chose, so it is
the main place where SSRF matters. It is always available; the user's
`enablePageContentFetch` toggle decides whether each browser actually uses it.
It shares the 10-requests-per-10-seconds bucket with `/search/` and
`/inference` (`/thumbnail` keeps its own budget, below), but each request can
fan out to six pages, so it is the heaviest per point.

`/thumbnail` is the second place the server fetches on a client's behalf: the
client loads each search-result thumbnail from it, one tile at a time, and the
`u` parameter is client-supplied. In practice it carries the URLs SearXNG
returned, but the endpoint is a general token-gated fetch for any public
raster image, so the guard must hold for arbitrary input: every hop passes
`resolvePublicUrlAndAddress` and then connects to the vetted address through
`requestPinnedToVettedAddress`, only raster content types are served, and the
response carries `nosniff` plus a sandbox CSP because it is same-origin. It
draws from its own rate-limit budget, since one grid fans out into up to 30
tile loads. The full audit behind these choices, item by item against the
issue's checklist, is in the next subsection.

Every hop - the original URL and each redirect - is validated before a
request is made, which blocks loopback, link-local (including
`169.254.169.254`), private, carrier-grade-NAT, multicast and reserved
addresses. On `/thumbnail` the address that was checked is also the address
the socket dials: `server/utils/pinnedFetch.ts` overrides the connect-time
resolver with the vetted IP, so a DNS answer that flips to a private address
after validation cannot be reached, while the original hostname is preserved
for TLS SNI, certificate verification and the `Host` header. `/page-content`
still checks the DNS answer rather than pinning it; that residual rebinding
window and why it is accepted are documented in `docs/page-content.md`.
Thumbnail responses are also capped in size, so an oversized image cannot pin
the server's memory.

### Thumbnail SSRF Audit (Issue #2524)

Audited 2026-09-17 on branch `security/thumbnail-ssrf-audit`. Each item of
the issue's checklist, answered from the code:

| Checklist item | Status | Where |
|---|---|---|
| Blocks private ranges (10/8, 172.16/12, 192.168/16) | Yes | `BLOCKED_CIDRS` / `isBlockedAddress`, `server/utils/publicUrl.ts` |
| Blocks link-local (169.254.0.0/16) | Yes | same table |
| Blocks loopback (127/8, `::1`) | Yes | same table |
| Blocks cloud metadata (169.254.169.254) | Yes | covered by the link-local block |
| Blocks IPv4-mapped IPv4-compatible IPv6 spellings | Yes | IPv4 blocks are matched in mapped form; the IPv4-compatible `::/96` is refused wholesale, as are NAT64/6to4/Teredo, whose embedded IPv4 cannot be vetted |
| Blocks DNS rebinding | Yes — this was the gap this issue closed | validate-then-pin: `resolvePublicUrlAndAddress` returns the vetted IP and `requestPinnedToVettedAddress` (`server/utils/pinnedFetch.ts`) connects to it without re-resolving; hostname is kept for SNI, certificate verification and `Host` |
| URL length limited | Yes | `MAX_THUMBNAIL_URL_LENGTH` (2048), refused before any work |
| Only HTTP/HTTPS schemes | Yes | `resolvePublicUrlAndAddress` |
| Redirects safe (no redirect to a private IP) | Yes | followed by hand in `fetchThumbnail`; every hop re-validated under one shared deadline |
| Content-Type checked to be an image | Yes | raster-only allowlist in `thumbnailEndpointServerHook.ts`; SVG is excluded because served same-origin it is a script-carrying document |
| Response size limited | Yes | `MAX_THUMBNAIL_BYTES` (500 KB) via `readCappedStream` |
| Timeout configured | Yes | `THUMBNAIL_TIMEOUT_MS` (3 s), shared across DNS and every hop |
| Rate limited per client | Yes | `thumbnailRateLimiter`, a dedicated 60-per-10-seconds budget keyed on client IP |
| Global rate limit | No, by design | the per-client limiter plus the shared token gate bound the total; a global cap would let one caller's grid starve every other user's tiles |

Residual risk after the change: the endpoint still fetches arbitrary public
URLs, so a caller can use it to GET any public host — bounded by the rate
limiter, the size cap and the timeout, and useful only for raster images.
Fetched content is untrusted: it is served with `nosniff` and a sandbox CSP,
and only raster types pass the allowlist. `/page-content` has not adopted the
pin and keeps the old rebinding residual.

## Threat Model

- **Local Environment**: Assumes trusted local execution
- **Network Requests**: All external requests go through SearXNG proxy
- **AI Models**: Models run locally or through trusted providers
- **Data Exfiltration**: Prevented by local-first architecture

## Related Topics

- **Configuration**: `docs/configuration.md` - Environment variables for access control
- **Overview**: `docs/overview.md` - Security architecture and data flow
- **AI Integration**: `docs/ai-integration.md` - Privacy implications of inference types
