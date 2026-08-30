# Failure Injection & Graceful Degradation

The suite exercises happy paths in the modules' own test files. This page maps
the complementary set: what MiniSearch does when a dependency misbehaves. Every
row is a Vitest case with the failure injected through a mocked `fetch`, a mocked
module boundary, or an injected circuit breaker, so no external service is
needed.

## Degradation Matrix

| Failure injected | Expected degradation | Where it is pinned |
| --- | --- | --- |
| SearXNG answers 500 once, then recovers | Retried with exponential backoff, results returned | `server/webSearchService.test.ts` › retry logic |
| SearXNG answers 500 on every attempt | Retry cycle exhausts (4 requests) and costs a single circuit-breaker failure | `server/webSearchService.test.ts` › graceful degradation |
| SearXNG answers 200 with no results and a transiently unresponsive engine (e.g. a timeout) once, then recovers | Retried with the same backoff, results returned, not counted as a failure | `server/webSearchService.test.ts` › retry logic |
| SearXNG answers 200 with no results and a non-suspending engine error (e.g. server API error) on every attempt | Retry cycle exhausts (4 requests), counts one failure, and `fetchSearXNG` throws with the engine reasons rather than an empty set, so the case takes the provider-down path below | `server/webSearchService.test.ts` › retry logic, graceful degradation |
| SearXNG answers 200 with no results and every unresponsive engine under a long suspension (CAPTCHA, rate limit) | Fails fast on the first attempt (1 request, no backoff), counts one failure, and throws the same error: a suspension outlasts the whole backoff by hours to a day | `server/webSearchService.test.ts` › retry logic |
| SearXNG fails five cycles in a row | Circuit opens; further searches short-circuit without calling the upstream | `server/webSearchService.test.ts` › graceful degradation |
| SearXNG recovers after the reset timeout | One healthy response closes the circuit again | `server/webSearchService.test.ts` › graceful degradation |
| SearXNG answers 200 with a non-JSON body | `fetchSearXNG` throws and the endpoint answers HTTP 502 | `server/webSearchService.test.ts` › graceful degradation |
| SearXNG returns results that are all unusable | Empty result set, no throw | `server/webSearchService.test.ts` › graceful degradation |
| Provider down vs. genuinely zero results | Provider down: `fetchSearXNG` throws, the endpoint answers HTTP 502, and the client search state becomes `failed`; genuinely zero results: HTTP 200 with `[]`, state stays `completed` and the no-results alert renders | `server/webSearchService.test.ts` and `server/searchEndpointServerHook.test.ts` › graceful degradation |
| SearXNG is down | `/search/text` and `/search/images` answer HTTP 502 with a JSON error | `server/searchEndpointServerHook.test.ts` › graceful degradation |
| Reranker is not ready | Results served in SearXNG order, HTTP 200 | `server/searchEndpointServerHook.test.ts` › graceful degradation |
| Reranking throws mid-request | Results served in SearXNG order, HTTP 200 | `server/searchEndpointServerHook.test.ts` › graceful degradation |
| Reranker is not ready on an image search | Images still served, with the thumbnail URLs as SearXNG sent them | `server/searchEndpointServerHook.test.ts` › graceful degradation |
| Reranking throws on an image search | Images still served, with the thumbnail URLs as SearXNG sent them | `server/searchEndpointServerHook.test.ts` › graceful degradation |
| Reranker returns a URL absent from the result set | That image is dropped | `server/searchEndpointServerHook.test.ts` › graceful degradation |
| Thumbnail host never answers | Request aborted after the timeout, `/thumbnail` answers HTTP 502 and the tile shows the host name | `server/thumbnailEndpointServerHook.test.ts` |
| DNS lookup for a thumbnail never settles | Bounded by the same deadline as the fetch, `/thumbnail` answers HTTP 502 | `server/thumbnailEndpointServerHook.test.ts` |
| Thumbnail URL resolves into a private range | Refused before any request, `/thumbnail` answers HTTP 403 | `server/thumbnailEndpointServerHook.test.ts` |
| Thumbnail redirects into a private range | Redirect not followed, HTTP 403 | `server/thumbnailEndpointServerHook.test.ts` |
| Thumbnail redirect carries a malformed Location | Not followed, HTTP 502, no unhandled rejection | `server/thumbnailEndpointServerHook.test.ts` |
| Thumbnail upstream answers with a non-raster or an empty body (SVG included) | `/thumbnail` answers HTTP 502, the tile shows the host name | `server/thumbnailEndpointServerHook.test.ts` |
| Thumbnail body exceeds the byte cap | Body truncated at the cap and served | `server/thumbnailEndpointServerHook.test.ts` |
| Thumbnail upstream refuses once, then recovers | The failure is not cached; the next tile load fetches again and serves | `server/thumbnailEndpointServerHook.test.ts` |
| `/thumbnail` budget is spent | HTTP 429 for the tiles only; the search budget is a separate limiter | `server/verifyTokenAndRateLimit.test.ts` |
| A tile's `/thumbnail` request fails in the browser | That tile shows the host name, the rest of the grid is untouched | `client/components/Search/Results/Graphical/ImageResultsList.test.tsx` |
| Search returns nothing to the endpoint | HTTP 200 with `[]`, not an error | `server/searchEndpointServerHook.test.ts` › graceful degradation |
| Text search returns nothing to the client | Keyword-only query retried as a fallback | `client/modules/textGeneration.degradation.test.ts` |
| Keyword fallback also returns nothing | Text search state stays `completed` with the no-results alert | `client/modules/textGeneration.degradation.test.ts` |
| SearXNG is down on the client | Text search state becomes `failed`, keyword fallback does not fire | `client/modules/textGeneration.degradation.test.ts` |
| Client search fails after a previous search populated the LLM channel | The grounding channel is cleared, so the AI can't ground on the previous query's results; when image search is on and it answers, the channel is repopulated with the (image)-tagged titles and URLs instead | `client/modules/textGeneration.degradation.test.ts` |
| Text search fails and the image search answers | The answer waits for the image results and grounds on their (image)-tagged titles and URLs, and the failed-state alert says so | `client/modules/textGeneration.degradation.test.ts` › search degradation |
| Live search fails but a stale cached result exists for the same query | The cached result is served flagged stale and the UI shows the "Showing cached results" banner | `client/modules/search.test.ts` › Stale Result Fallback |
| Result page host resolves into a private range | Page skipped, no request is made | `server/pageContentService.test.ts` › fetchPageContents |
| Result page redirects into a private range | Redirect not followed, page skipped | `server/pageContentService.test.ts` › fetchPageContents |
| Result page errors, is not a document, or yields no text | That page is skipped, the others still return | `server/pageContentService.test.ts` › fetchPageContents |
| Result page body never ends | Reading stops at the byte cap | `server/pageContentService.test.ts` › fetchPageContents |
| `/page-content` errors or never answers | Answer falls back to snippets, search still completes | `client/modules/pageContent.test.ts`, `client/modules/textGeneration.degradation.test.ts` › page content grounding |
| `/inference` upstream is not configured | HTTP 500 with a JSON error | `server/internalApiEndpointServerHook.test.ts` › environment configuration |
| `/inference` cannot list upstream models | HTTP 500 with a JSON error | `server/internalApiEndpointServerHook.test.ts` › streaming path |
| Upstream model fails but another one is available | Retried on the next model, answer still streams | `server/internalApiEndpointServerHook.test.ts` › streaming path |
| Every model fails before a single token is sent | HTTP 503 with a JSON error | `server/internalApiEndpointServerHook.test.ts` › streaming path |
| Upstream stream ends without a finish part | Treated as a failure: retried, then `Stream ended unexpectedly` as the last error | `server/internalApiEndpointServerHook.test.ts` › streaming path |
| Upstream fails after content was already sent | No retry, SSE error frame, the partial answer stands | `server/internalApiEndpointServerHook.test.ts` › streaming path |
| Response is already unwritable when streaming would start | No headers set, the upstream is never called | `server/internalApiEndpointServerHook.test.ts` › streaming path |
| `/inference` answers 503 | Generation state becomes `failed`, nothing persisted | `client/modules/textGeneration.degradation.test.ts` |
| Generation interrupted mid-stream | Partial answer preserved, state stays `interrupted` | `client/modules/textGeneration.degradation.test.ts` |

## Adding a Row

Keep each case next to the module it covers, reusing that file's mocks and
harness: a `describe("graceful degradation")` block where the file has no
failure-shaped block yet, the existing one where it does (the `/inference` rows
live under `environment configuration` and `streaming path`), or a sibling
`*.degradation.test.ts` when the case needs a harness of its own (the client
rows drive `searchAndRespond` through a fake pubSub store). A row earns
its place when it fails for the right reason: mutate the degradation branch in
the module (delete the `catch`, the fallback, or the interrupt check) and confirm
the case goes red before committing it.

## Related Topics

- **Development Commands**: `docs/development-commands.md` - Running the suite
- **Reranking**: `docs/reranking.md` - Reranker lifecycle and readiness
- **Page Content**: `docs/page-content.md` - Reading result pages and its failure behavior
- **AI Integration**: `docs/ai-integration.md` - Inference backends
- **Overview**: `docs/overview.md` - Search and inference data flow
