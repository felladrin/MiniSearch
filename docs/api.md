# HTTP API Reference

Every server-side route is a Vite middleware hook declared in `vite.config.ts`
(see the server hook system section of `docs/overview.md`), so the endpoints
below behave identically in dev (`vite`) and in the production preview
(`vite preview`) that the Docker image runs.

These endpoints exist for the browser app rather than as a public API: they are
unversioned, and their shapes are the ones the client happens to need. They are
documented here because the owner of an instance can reach them, and because
reading middleware should not be the only way to learn what a request has to
carry.

| Method | Path | Token | Rate limit | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/search/text` | required | shared | Text results from SearXNG, reranked |
| `GET` | `/search/images` | required | shared | Image results from SearXNG, reranked |
| `GET` | `/page-content` | required | shared | Readable text from result pages, for answer grounding |
| `GET` | `/thumbnail` | required | own budget | One image-result thumbnail, fetched server-side |
| `POST` | `/inference` | required | shared | Streaming chat completion from the internal API |
| `GET` | `/status` | none | none | Uptime, counters, and service health |
| `GET` | `/api/config` | none | none | Runtime client configuration, including the search token |
| `POST` | `/api/validate-access-key` | none | shared | Access key check |

A path that matches no hook falls through to Vite's static handler, which is
also what a method mismatch does on `/api/config` and `/api/validate-access-key`:
those two answer only their documented method and call `next()` otherwise, so a
`GET` on the validation endpoint returns the app shell, not a 405.

Those two compare the whole request target, query string included, so
`/api/config?v=2` falls through as well. The `GET` endpoints in the table above
do not check the method at all: a `POST` to `/search/text` is served like a
`GET`. Only `/inference` answers `405`.

## Authentication

### Search token

The token is CSRF protection, not authorization: it proves a request came from
a page this server served. `server/searchToken.ts` writes it at build time,
reads it on first use and then holds it for the life of the process, and
`/api/config` hands it out.

A client never sends the raw token. It hashes it with argon2id using the
parameters in `shared/argon2Parameters.ts` (`m=512, t=16, p=1`, 32-byte output,
encoded form) and sends the resulting hash as the `token` query parameter:

```bash
TOKEN=$(curl -s http://localhost:7860/api/config | jq -r .searchToken)
# hash $TOKEN with argon2id using the parameters above; see
# client/modules/searchTokenHash.ts
curl "http://localhost:7860/search/text?q=hello&token=$ARGON2_HASH"
```

The hash is salted per client, so it differs between browsers and every one of
them verifies. The server checks the encoded parameter block before running
`argon2Verify`, so a hash carrying different parameters is refused for free.
The whole lifecycle is in
the search token lifecycle section of `docs/security.md`.

Verification runs before parameters are parsed, so a malformed request from an
unauthenticated caller still costs a rate-limit point. The exception is
`/inference`, which answers `405` and `415` before it looks at the token, so
those two rejections need no token and spend no rate-limit point. The failures
below are the same on every token-gated endpoint:

| Status | Body | When |
| --- | --- | --- |
| `429` | `{"error":"Too many requests."}` | The bucket for this client is empty |
| `400` | `{"error":"Missing token."}` | No `token` parameter |
| `401` | `{"error":"Invalid token."}` | The hash does not verify against this server's token |

A 401 that persists across reloads usually means two processes hold different
tokens: the server logs that once, on the way out.

### Access keys

`ACCESS_KEYS` gates the app's UI, not these endpoints. The client asks
`/api/validate-access-key` before rendering and stores the accepted hash
locally; nothing about that key travels on a later search or inference request.
An instance that must not answer unauthenticated callers needs something in
front of it.

### Rate limits

`server/verifyTokenAndRateLimit.ts` keeps two in-memory buckets, both keyed by
client IP:

| Bucket | Budget | Consumed by |
| --- | --- | --- |
| shared | 10 requests / 10 s | `/search/text`, `/search/images`, `/page-content`, `/inference`, `/api/validate-access-key` |
| thumbnail | 60 requests / 10 s | `/thumbnail` |

`/thumbnail` has its own budget because one image search fans out into up to 30
tile loads, which would otherwise consume a user's whole search budget. The
point is consumed before token verification and before any argon2 work, so a
flood of bogus tokens is bounded too.

The key is the TCP peer address. `X-Forwarded-For` and `X-Real-IP` are honored
only when `TRUST_PROXY` is `true` or `1`; on a directly-exposed instance they
are client-controlled, and trusting them would hand every request a fresh
identity.

## Endpoints

### `GET /search/text`

Query parameters:

| Name | Required | Description |
| --- | --- | --- |
| `q` | yes | Search query, trimmed, 1 to 2000 characters |
| `token` | yes | Search token hash |
| `limit` | no | How many of SearXNG's results to consider, default and maximum 30; a value that is not a positive integer falls back to the default. SearXNG is not sent this number: it caps a single SearXNG response after duplicate URLs are dropped, and the score filter below can return fewer |

Responds with a JSON array of tuples, in the order the client renders them:

```json
[
  ["Result title", "Snippet text", "https://example.com/page", 3.7]
]
```

Between SearXNG and the response the server drops duplicate URLs, keeps the
first `limit` of what remains, and discards results with no title or no snippet.
Index 0 is the first result that survives that.

The order is not a score sort. That first surviving result is pinned at index 0
and is the one result the score filter never drops; the next nine are the first
nine survivors in SearXNG's order, sorted by score among themselves; everything
after them is sorted by score too. So a result SearXNG ranked eleventh can
outscore index 1 and still arrive at index 10 (`server/rankSearchResults.ts`,
and the preserve top results section of `docs/reranking.md`).

Reranking drops results rather than only reordering them. Every score is first
shifted by the absolute value of the lowest score in the batch, which puts the
lowest at zero only when it is negative; everything below
`mean - 0.3 * standardDeviation` on that shifted scale is filtered out. If that
leaves fewer than 40% of the batch, the threshold becomes 40% of the highest
shifted score instead, so the fallback keeps far more of an all-positive batch
than of one that straddles zero. The response carries only the survivors, so
neither threshold can be recomputed from it. On `/search/text` the filter sees
results 2..N only, since index 0 is exempt; on `/search/images` it sees all of
them. Fewer results than `limit` is therefore normal on both, not a sign of an
outage.

The fourth element is the reranker's raw relevance logit, deliberately not
passed through a sigmoid (see `docs/reranking.md`). It is absent when the
reranker is unhealthy or a rerank call fails, in which case SearXNG's own order
is returned unranked and unfiltered, so a client must treat the score as
optional.

Failures:

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"Missing query parameter"}` | `q` missing or blank |
| `400` | `{"error":"Query parameter must not exceed 2000 characters"}` | `q` too long |
| `502` | `{"error":"Search service unavailable"}` | SearXNG unreachable, so an outage is distinguishable from a search with no matches |
| `500` | `{"error":"Internal server error"}` | Anything else |

### `GET /search/images`

Same parameters and failures as `/search/text`. The hook claims the whole
`/search/` prefix and treats every path that does not start with `/search/text`
as an image search, so `/search/anything` is an image search.

The ordering above does not carry over: image results are a plain score sort,
nothing is pinned at index 0, and no result is exempt from the score filter
(`preserveTopResults` is only passed for text, see `docs/reranking.md`).

Responds with a JSON array of four-element tuples:

```json
[
  [
    "Image title",
    "https://example.com/page-that-embeds-it",
    "https://example.com/thumb.jpg",
    "https://example.com/full.jpg"
  ]
]
```

In order: the title, cut to 100 characters because that is the length the
reranker sees, the page the image was found on, the thumbnail URL exactly as
SearXNG returned it, and the full image. The last is the embeddable player
URL for a video result, and an empty string when there is nothing to link to.

The response never waits on a thumbnail host; the client loads each tile
through `/thumbnail`. A result SearXNG returned without a thumbnail URL is
dropped before the response, since the grid would have nothing to show for it.

### `GET /page-content`

Reads the pages behind a handful of results and returns the passages that match
the query. Unlike `/search/`, this endpoint fetches URLs the caller chose, so it
is SSRF-guarded, byte-capped and timed out per page
(see `docs/page-content.md`).

The path is matched exactly, so `/page-content/anything` falls through.

| Name | Required | Description |
| --- | --- | --- |
| `q` | yes | Query the passages are ranked against, 1 to 2000 characters |
| `token` | yes | Search token hash |
| `url` | yes | Page to read, `http` or `https`, up to 2048 characters. Repeat for more; at most 6 per request, counted before duplicates are removed, so 7 URLs are refused even when two of them are the same |

Responds with an object keyed by URL:

```json
{
  "https://example.com/page": "The passage that best covers the query.\nThe next best passage from the same page."
}
```

A page that could not be read, was refused by the SSRF guard, or yielded too
little text is simply absent from the object; `{}` means nothing was read. That
is not an error, and the client degrades to snippet-only answers for those
results.

Failures: `400` with the first validation message (`Missing query parameter`,
`Query parameter must not exceed 2000 characters`, `Missing url parameter`,
`Invalid URL parameter`, `No more than 6 URLs can be read per request`), or
`500` `{"error":"Internal server error"}`. A `url` over 2048 characters is
answered `Invalid URL parameter`, the same as any other unusable URL.

### `GET /thumbnail`

Fetches one image-result thumbnail server-side, so the browser never requests a
search-result URL directly.

| Name | Required | Description |
| --- | --- | --- |
| `u` | yes | Thumbnail URL, up to 2048 characters |
| `token` | yes | Search token hash |

A hit responds with the image bytes and the upstream's content type, restricted
to `image/avif`, `image/bmp`, `image/gif`, `image/jpeg`, `image/png`,
`image/webp`, `image/x-icon` and `image/vnd.microsoft.icon`. SVG is refused
because it would be a scriptable document on this origin. Responses carry
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
and `Cache-Control: private, max-age=3600`.

The fetch is bounded by a 3 s deadline covering DNS and every hop, at most 3
redirects, each of them re-validated, and 500 KB of body. Successful fetches are
held in an in-process LRU (100 entries, 50 MB); failures never are.

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"Missing thumbnail URL"}` | `u` missing |
| `400` | `{"error":"Thumbnail URL too long"}` | `u` over 2048 characters |
| `403` | `{"error":"Refusing to fetch a thumbnail from a non-public or unresolvable address"}` | The host is in private space, does not resolve, or `u` is not a parseable `http`/`https` URL. `/page-content` answers `400` for that last case; this endpoint does not distinguish it |
| `502` | `{"error":"Thumbnail could not be fetched"}` | Upstream failed, timed out, redirected more than 3 times, answered with a type outside the list, or sent an empty body |
| `500` | `{"error":"Internal server error"}` | Anything the hook itself threw, caught so Vite's connect stack does not see an unhandled rejection |

Error responses carry `Cache-Control: no-store`, since neither a refusal nor an
upstream failure is a stable property of the URL.

### `POST /inference`

Streams a chat completion from the API configured through
`INTERNAL_OPENAI_COMPATIBLE_API_*` (see `docs/configuration.md`), so
an instance can offer a model without publishing its key.

Requires `Content-Type: application/json` and the token as the `token` query
parameter. The body is at most 1 MiB:

```json
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "temperature": 0.7,
  "top_p": 0.9,
  "max_tokens": 512
}
```

`messages` needs at least one entry, each with a `role` of `system`, `user` or
`assistant` and a string `content`. `temperature` is clamped to 0-2, `top_p` to
0-1, and `max_tokens` to the server's `defaultMaxTokens`
(`server/config/modelConfig.ts`).

The response is an OpenAI-compatible SSE stream of
`chat.completion.chunk` objects, ending with a chunk whose `finish_reason` is
`"stop"` and then `data: [DONE]`:

```
data: {"id":"chatcmpl-1730000000000","object":"chat.completion.chunk","created":1730000000,"model":"some-model","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}

data: {"id":"chatcmpl-1730000000000","object":"chat.completion.chunk","created":1730000000,"model":"some-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

When a model stalls or fails before the first token, the server retries with
another model from the provider's list, up to 5 attempts. That ladder needs the
list: with `INTERNAL_OPENAI_COMPATIBLE_API_MODEL` pinned there is no second
model to try, so the first failure is the last attempt. Once bytes have been
written the status line is already sent, so a later failure arrives as a data
frame carrying an `error` field, followed by `[DONE]`, rather than as a status
code.

The stream carries `Content-Type: text/event-stream`, `Cache-Control: no-cache`
and `Connection: keep-alive`.

Failures before the stream starts:

| Status | Body | When |
| --- | --- | --- |
| `405` | `{"error":"Method Not Allowed"}` | Not a `POST`; the response carries `Allow: POST`. Checked before the token, so it needs no token and spends no rate-limit point |
| `415` | `{"error":"Unsupported Media Type"}` | `Content-Type` is not JSON; also checked before the token |
| `400` | `{"error":"Invalid request body"}` or `{"error":"Invalid request body: <field> <message>"}` | Unparseable or schema-invalid body |
| `413` | `{"error":"Request body too large"}` | Body over 1 MiB |
| `500` | `{"error":"OpenAI API configuration is missing"}` | `INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL` or `_API_KEY` unset |
| `500` | `{"error":"Failed to fetch available models"}` | No model configured and the provider's listing failed |
| `500` | `{"error":"No model available"}` | The listing succeeded but was empty |
| `503` | `{"error":"Service unavailable - all models failed","lastError":"..."}` | Every attempt failed before the first token |
| `500` | `{"error":"Internal server error","message":"..."}` | Anything else the hook threw |

### `GET /status`

The hook claims the `/status` prefix, so `/status/anything` answers the same
way.

Unauthenticated and not rate-limited: uptime, the counters accumulated since
the last restart, and the health of the reranker, the bi-encoder and SearXNG.
The field reference is the `/status` section of `docs/overview.md`.

Nothing in the response is per-user: queries, URLs and client addresses are
never recorded, only aggregate outcomes
(see the privacy section of `docs/security.md`).

### `GET /api/config`

Unauthenticated by design: the client needs it before it can prove anything,
and the access key page depends on it. Served with `Cache-Control: no-store`, so
a restart with different environment variables takes effect on the next reload.

```json
{
  "accessKeysEnabled": false,
  "accessKeyTimeoutHours": 0,
  "wllamaDefaultModelId": "...",
  "internalApiEnabled": false,
  "internalApiName": "...",
  "defaultInferenceType": "...",
  "searchToken": "..."
}
```

The shape is `ServerConfig` in `shared/serverConfig.ts`. It reports whether a
feature is on plus its display defaults, and never `ACCESS_KEYS`,
`INTERNAL_OPENAI_COMPATIBLE_API_KEY`, or any other secret: a field added to that
interface is published to anyone who can reach the instance
(see the `/api/config` exposure section of `docs/security.md`).

### `POST /api/validate-access-key`

Checks a client-hashed access key against `ACCESS_KEYS`. Consumes a point from
the shared bucket before the argon2 loop, since a wrong hash costs one full
verification per configured key.

```json
{ "accessKeyHash": "$argon2id$v=19$m=512,t=16,p=1$..." }
```

Responds `{"valid":true}` or `{"valid":false}`. A hash whose parameter block
differs from `shared/argon2Parameters.ts` is answered `{"valid":false}` without
any verification running.

| Status | Body | When |
| --- | --- | --- |
| `429` | `{"error":"Too many requests."}` | Rate limited, kept distinct from a wrong key so the UI can say "try again" |
| `400` | `{"valid":false,"error":"Invalid request"}` | Body is not JSON |

## Related Topics

- **Overview**: `docs/overview.md` - Server hook system and the `/status` field reference
- **Security**: `docs/security.md` - Token lifecycle, access control, and privacy model
- **Configuration**: `docs/configuration.md` - Environment variables the endpoints read
- **Page Content**: `docs/page-content.md` - What `/page-content` does with the pages it reads
- **Reranking**: `docs/reranking.md` - Where the search score comes from
