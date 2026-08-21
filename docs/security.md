# Security

## Access Control

- **Optional Access Keys**: `ACCESS_KEYS` environment variable for usage restriction
- **Rate Limiting**: Applied to search and inference endpoints
- **Server-side Validation**: Access keys verified before proxying to SearXNG
- **Key Timeout**: `ACCESS_KEY_TIMEOUT_HOURS` controls cache duration

### Access Key Validation Flow

1. User enters access key on the **AccessPage** UI
2. Client hashes the key client-side using argon2id
3. Server validates the hash against configured `ACCESS_KEYS` via `validateAccessKeyServerHook`
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

1. **Token Generation**: On build/startup, `regenerateSearchToken()` writes a random token to `{os.tempdir()}/minisearch-token`, readable only by the user running the build (`0600`)
2. **Client Injection**: The token is injected as `VITE_SEARCH_TOKEN` compile-time constant via Vite's `define` option
3. **Per-Request Auth**: Client includes token as `?token=` parameter on all `/search/text`, `/search/images` and `/page-content` requests
4. **Server Verification**: `handleTokenVerification()` in `searchEndpointServerHook.ts` validates the token before proxying to SearXNG
5. **Session Tracking**: Validated tokens are stored in an in-memory `Set<string>` (`verifiedTokens.ts`) for session counting

## Privacy

- **Local-First Storage**: All data stored in IndexedDB, no cloud sync
- **No Tracking**: No telemetry, analytics, or user tracking
- **SearXNG Integration**: All web searches routed through privacy-focused metasearch
- **No External Requests**: Optional browser-only mode for complete privacy
- **Page Reading Is On By Default, And Reversible**: `enablePageContentFetch` ships on and the user can turn it off under AI Settings; nothing is read until AI responses are enabled, and the server (never the browser) requests the top result pages, so those sites see the instance and no user cookies or IP
- **Search And Page Reading Leave No Query In The Log**: The search query is never written to the server log, and neither is the URL of a page read for grounding; how often searches come back empty, fail on unresponsive engines or are fully discarded, and how page reads ended, are counted instead and reported on `/status` (`searchesWithoutResults`, `searchesWithUnresponsiveEngines`, `searchesWithAllResultsDiscarded`, `pageReads`). Anything in front of the instance keeps its own access log, where `?q=` appears in full

- **Rejections Are Counted, Not Logged**: A request turned away for a missing or invalid token, or by the rate limiter, is counted by reason and by endpoint family on `/status`; the client address the limiter keys on is never stored or reported

## Data Protection

- **Access Key Hashing**: Access keys hashed using argon2id before storage (via hash-wasm)
- **TTL-based Cleanup**: Automatic cleanup of cached data
- **No PII Collection**: No personally identifiable information stored
- **User Control**: Users can export and delete all their data

## Security Best Practices

- Input validation on all endpoints
- Sanitization of user-generated content
- Search token generation: a per-build/per-startup token written to a temp file (`server/searchToken.ts`), using 32 bytes from the `node:crypto` CSPRNG, with the file restricted to its owner (`0600`)
- HTTPS enforcement in production
- Regular dependency updates via Renovate
- **Argon2 Hashing**: Access keys hashed using argon2id for secure validation (not storage encryption)
- **Cross-Origin Isolation**: COOP/COEP headers for SharedArrayBuffer security
- **CSRF Protection**: Search tokens validated via argon2 hash comparison, over a 32-byte digest

## Server-Side Security Modules

| Module | Purpose |
|--------|---------|
| `server/searchToken.ts` | Reads/writes the CSRF token from `{tempdir}/minisearch-token` |
| `server/verifiedTokens.ts` | In-memory `Set<string>` of verified session tokens |
| `server/searchesSinceLastRestart.ts` | In-memory counters for aggregate search outcomes (text/image search totals, and how often searches came back empty or were fully discarded), reported on `/status` |
| `server/pageReadsSinceLastRestart.ts` | In-memory aggregate counters for pages read for grounding (outcomes, durations, passage ratios), reported on `/status`; records no query, URL, host, or per-read timestamp |
| `server/searchEndpointServerHook.ts` | Proxies text/image search to SearXNG after token verification (via `handleTokenVerification`) |
| `server/verifyTokenAndRateLimit.ts` | Verifies the Argon2 token hash and enforces rate limiting (10 requests per 10 seconds) shared by the search, page-content and inference endpoints |
| `server/handleTokenVerification.ts` | Middleware bridge that calls `verifyTokenAndRateLimit` and writes 400/401/429 error responses for the search, page-content and inference endpoints |
| `server/configEndpointServerHook.ts` | Serves the non-secret runtime config at `/api/config`, including whether access keys are enabled |
| `server/utils/publicUrl.ts` | Rejects non-HTTP schemes and hosts resolving into private, loopback, link-local or reserved ranges before the server fetches a client-supplied URL |
| `server/pageContentEndpointServerHook.ts` | Reads result pages at `/page-content` after token verification, capped at 6 URLs per request |

### Server-Side Fetching of Client-Supplied URLs

`/page-content` is the endpoint that fetches a URL the client chose, so it is
the main place where SSRF matters. It is always available; the user's
`enablePageContentFetch` toggle decides whether each browser actually uses it.
It shares the 10-requests-per-10-seconds bucket with `/search/`, but each
request can fan out to six pages, so it is the heavier of the two per point.

`/search/images` also fetches on the server's behalf: the thumbnail URLs that
come back from SearXNG are fetched and returned as data URLs. Thumbnails are
harder for an attacker to steer than a client-chosen page URL, but a
compromised or hostile engine result could still point the server at an
internal address, so the same guard applies.

Every hop - the original URL and each redirect - passes `resolvePublicUrl`
before a request is made, which blocks loopback, link-local (including
`169.254.169.254`), private, carrier-grade-NAT, multicast and reserved
addresses. The DNS answer is checked rather than pinned; the residual rebinding
window and why it is accepted are documented in `docs/page-content.md`.
Thumbnail responses are also capped in size, so an oversized image cannot pin
the server's memory.

## Threat Model

- **Local Environment**: Assumes trusted local execution
- **Network Requests**: All external requests go through SearXNG proxy
- **AI Models**: Models run locally or through trusted providers
- **Data Exfiltration**: Prevented by local-first architecture

## Related Topics

- **Configuration**: `docs/configuration.md` - Environment variables for access control
- **Overview**: `docs/overview.md` - Security architecture and data flow
- **AI Integration**: `docs/ai-integration.md` - Privacy implications of inference types
