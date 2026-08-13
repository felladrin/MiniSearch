# Page Content Grounding

By default the AI answer is built from what SearXNG returns: a title, a one- or
two-sentence snippet, and a URL per result. That is a thin base to cite from,
and it is the main reason an answer can read as confident and still be wrong -
the model is asked to source facts it can only infer from fragments.

With the **Read Page Content** setting on (AI Settings, off by default), the
instance also reads the pages behind the top results and feeds the passages
that match the query into the prompt.

## Flow

1. `startTextSearch` (`client/modules/textGeneration.ts`) finishes the text
   search and publishes the results the UI renders.
2. The top `searchResultsToConsider` (6) URLs go to `/page-content`, together
   with the query, via `client/modules/pageContent.ts`.
3. `server/pageContentService.ts` reads each page, extracts its readable text,
   splits it into passages, and returns the passages that best cover the query.
4. The response is published to the `pageContents` PubSub channel, keyed by URL.
5. `getFormattedSearchResults` (`client/modules/textGenerationUtilities.ts`)
   appends each excerpt under its result before the prompt is built.

The request is awaited inside the search promise, so generation waits for it
while the search results are already on screen. Nothing else blocks on it.

## Prompt Shape

```
• [Title](https://example.com/article) | The search snippet.
  Page excerpt: The passage the extractor kept, in document order.
  A second passage from the same page.
• [Other result](https://other.example/) | Another snippet.
```

Results whose page could not be read keep their snippet-only line, so a partial
read degrades one result at a time rather than the whole answer.

## Extraction

`server/pageContentService.ts` converts HTML with `html-to-text`, preferring the
innermost `article` / `main` / `[role="main"]` container and skipping nav,
header, footer, aside, forms and inline widgets. Readability-style extraction
via `@mozilla/readability` would score better on hostile layouts, but it needs a
full DOM implementation at runtime; `html-to-text` is already a dependency and
the passage ranking absorbs most of what boilerplate removal would have.

Passages are ranked by how much of the query they cover, with a small prior for
lead passages (the definition or summary usually opens a page). The prior
settles ties; it cannot outweigh coverage.

## Budgets and Limits

| Limit | Value | Where |
|---|---|---|
| Pages read per search | 6 | `searchResultsToConsider`, mirrored by `MAX_URLS` in the endpoint |
| Per-page request timeout | 6 s | `REQUEST_TIMEOUT_MS` |
| Redirects followed | 3, each re-validated | `MAX_REDIRECTS` |
| Body read per page | 1.5 MB | `MAX_RESPONSE_BYTES` |
| Extracted text per page | 6,000 characters | `MAX_PAGE_CHARS` |
| Minimum usable text | 200 characters | `MIN_USEFUL_CHARS` |
| Passage size | 180-1,200 characters | `MIN_PASSAGE_CHARS`, `MAX_PASSAGE_CHARS` |
| Excerpt share of the context | 35% | `pageContentTokenBudgetRatio` |
| Whole-request timeout (client) | 20 s | `REQUEST_TIMEOUT` in `client/modules/pageContent.ts` |

The token budget is shared across pages, served shortest-first: a page that
needs less than its share leaves the rest to the others, and only pages that
overflow are cut, with an ellipsis marking the cut.

## Privacy

The setting is off by default because it changes who learns about a search.
Snippet-only answers are seen by SearXNG and its upstream engines. Reading a
page adds one request from the instance to each site behind the top results,
which tells those sites their page was fetched. The request comes from the
instance, never from the browser, so it carries no user cookies and no client
IP; it identifies itself as MiniSearch.

## Safety

The endpoint takes URLs from the client, so every fetch goes through
`resolvePublicUrl` (`server/utils/publicUrl.ts`) first. It rejects non-HTTP
schemes and any host that resolves into loopback, link-local (including the
cloud metadata address `169.254.169.254`), private, carrier-grade-NAT,
multicast or reserved space - and it re-checks on every redirect hop, since
`redirect: "follow"` would otherwise let a public URL bounce the server into
the private network it runs in.

The DNS answer is checked, not pinned, so a name that flips to a private
address between the check and the fetch would still get through. Closing that
gap means connecting to the vetted IP directly, which breaks TLS hostname
verification; instead the reachable surface is kept small, since the only thing
that comes back is extracted text.

Extracted text is data, not instruction. It reaches the model inside the search
results block of the system prompt, which is the same trust level snippets
already had - a page that tries to talk to the model is a page the model should
weigh as a source, and the prompt asks it to cite what it uses.

## Failure Behavior

Every failure degrades to the snippet-only prompt, which is what the answer was
grounded on before:

| Failure | Result |
|---|---|
| Host resolves privately, or the scheme is not HTTP | That page is skipped, no request is made |
| Page times out, errors, or is not a document | That page is skipped |
| Page yields less than 200 characters | That page is skipped |
| `/page-content` fails or times out | Answer falls back to snippets |
| Setting off, or AI responses off | No page is ever read |

## Related Topics

- **Overview**: `docs/overview.md` - Search and AI generation flow
- **Configuration**: `docs/configuration.md` - The `enablePageContentFetch` setting
- **Security**: `docs/security.md` - Endpoint hardening and the threat model
- **Reranking**: `docs/reranking.md` - How the results that get read are ordered
- **Failure Injection**: `docs/failure-injection.md` - Degradation matrix
