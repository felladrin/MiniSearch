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

### Search Token Lifecycle

Every HTTP request from client to backend carries a `token` query parameter for CSRF protection:

1. **Token Generation**: On build/startup, `regenerateSearchToken()` writes a random token to `{os.tempdir()}/minisearch-token`
2. **Client Injection**: The token is injected as `VITE_SEARCH_TOKEN` compile-time constant via Vite's `define` option
3. **Per-Request Auth**: Client includes token as `?token=` parameter on all `/search/text` and `/search/images` requests
4. **Server Verification**: `handleTokenVerification()` in `searchEndpointServerHook.ts` validates the token before proxying to SearXNG
5. **Session Tracking**: Validated tokens are stored in an in-memory `Set<string>` (`verifiedTokens.ts`) for session counting

## Privacy

- **Local-First Storage**: All data stored in IndexedDB, no cloud sync
- **No Tracking**: No telemetry, analytics, or user tracking
- **SearXNG Integration**: All web searches routed through privacy-focused metasearch
- **No External Requests**: Optional browser-only mode for complete privacy

## Data Protection

- **Access Key Hashing**: Access keys hashed using argon2id before storage (via hash-wasm)
- **TTL-based Cleanup**: Automatic cleanup of cached data
- **No PII Collection**: No personally identifiable information stored
- **User Control**: Users can export and delete all their data

## Security Best Practices

- Input validation on all endpoints
- Sanitization of user-generated content
- Search token generation: a per-build/per-startup token written to a temp file (`server/searchToken.ts`); note this currently uses `Math.random()`, not a cryptographically secure random source
- HTTPS enforcement in production
- Regular dependency updates via Renovate
- **Argon2 Hashing**: Access keys hashed using argon2id for secure validation (not storage encryption)
- **Cross-Origin Isolation**: COOP/COEP headers for SharedArrayBuffer security
- **CSRF Protection**: Search tokens validated via argon2 hash comparison

## Server-Side Security Modules

| Module | Purpose |
|--------|---------|
| `server/searchToken.ts` | Reads/writes the CSRF token from `{tempdir}/minisearch-token` |
| `server/verifiedTokens.ts` | In-memory `Set<string>` of verified session tokens |
| `server/searchesSinceLastRestart.ts` | In-memory counters for abuse monitoring |
| `server/searchEndpointServerHook.ts` | Proxies text/image search to SearXNG after token verification (via `handleTokenVerification`) |
| `server/verifyTokenAndRateLimit.ts` | Verifies the Argon2 token hash and enforces rate limiting (10 requests per 10 seconds) shared by search and inference endpoints |
| `server/handleTokenVerification.ts` | Middleware bridge that calls `verifyTokenAndRateLimit` and writes 400/401/429 error responses for the search and inference endpoints |

## Threat Model

- **Local Environment**: Assumes trusted local execution
- **Network Requests**: All external requests go through SearXNG proxy
- **AI Models**: Models run locally or through trusted providers
- **Data Exfiltration**: Prevented by local-first architecture

## Related Topics

- **Configuration**: `docs/configuration.md` - Environment variables for access control
- **Overview**: `docs/overview.md` - Security architecture and data flow
- **AI Integration**: `docs/ai-integration.md` - Privacy implications of inference types
