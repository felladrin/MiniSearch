# Search Result Reranking

MiniSearch optionally reranks search results using a cross-encoder model running on a local `llama-server` instance. This secondary search stage reorders initial SearXNG results based on their semantic relevance to the user's query.

## Architecture Overview

The reranking subsystem consists of three components:

| Component | File | Responsibility |
|-----------|------|----------------|
| Service Manager | `server/rerankerService.ts` | llama-server lifecycle, health checks, reranking API calls |
| Ranking Logic | `server/rankSearchResults.ts` | Score-based filtering and result reordering |
| Server Hook | `server/rerankerServiceHook.ts` | Startup/shutdown coordination with Vite server |

## Service Lifecycle

### Startup

The `rerankerServiceHook` starts the reranker during server initialization:

1. Downloads the model from HuggingFace if not present (`Felladrin/gguf-jina-reranker-v1-tiny-en/jina-reranker-v1-tiny-en-Q8_0.gguf`)
2. Spawns `llama-server` as a child process
3. Polls `/health` endpoint until status is `ok`
4. Performs a warmup rerank request (`query: "test"`, `documents: ["test document"]`) to ensure the model is fully loaded
5. Sets `isReady = true`

### llama-server Configuration

The reranker process is spawned with these arguments:

| Argument | Value | Purpose |
|----------|-------|---------|
| `--model` | `jina-reranker-v1-tiny-en-Q8_0.gguf` | Cross-encoder reranking model |
| `--ctx-size` | 2048 | Context window size |
| `--batch-size` | 2048 | Batch processing size |
| `--ubatch-size` | 2048 | Micro-batch size |
| `--flash-attn` | auto | Flash attention optimization |
| `--host` | 127.0.0.1 | Local-only binding |
| `--port` | 8012 | Service port |
| `--threads` | 1 | Single-threaded operation |
| `--parallel` | 1 | Single parallel request |
| `--reranking` | (flag) | Enable reranking mode |
| `--pooling` | rank | Rank pooling strategy |

### Automatic Restart

If the `llama-server` process exits unexpectedly:

1. `isReady` is set to `false`
2. A 5-second restart timeout is scheduled
3. `startRerankerService()` is called again automatically
4. Binary compatibility errors (`SIGTRAP`, `SIGILL`) are logged with architecture details

### Shutdown

On server close, `stopRerankerService()` clears any pending restart timeout and kills the child process.

## Health Monitoring

`getRerankerStatus()` performs a live health check by fetching `/health` from the llama-server. Returns `false` if:
- `isReady` flag is `false`
- Health endpoint is unreachable
- Response status is not `ok`

The search endpoint checks reranker health before attempting ranking and falls back to unranked SearXNG results if unhealthy.

## Reranking Process

### Document Preparation

Search results are formatted as Markdown-style strings and truncated:

```typescript
const doc = `[${title}](${url} "${snippet}")`.toLocaleLowerCase();
// Truncated to MAX_DOCUMENT_LENGTH (512 characters)
```

Both query and documents are lowercased and Unicode surrogates are sanitized before sending to the reranker.

### Unicode Sanitization

`sanitizeUnicodeSurrogates()` validates Unicode surrogate pairs in input strings. Invalid surrogates are replaced with the Unicode replacement character (`\ufffd`). This prevents crashes when processing malformed UTF-8 from web search results.

### Scoring and Filtering

The reranker returns relevance scores for each document. Results are filtered using a two-stage statistical approach:

1. **Score Normalization**: Scores are shifted to positive range by adding the absolute value of the minimum score
2. **Standard Deviation Filter**: Results below `mean - kStandardDeviationFactor * standardDeviation` are filtered out
   - `kStandardDeviationFactor = 0.3`
3. **Percentage Fallback**: If fewer than 40% of results pass the standard deviation filter, a fallback threshold is applied:
   - `minPercentageFallback = 0.4` (40% of the highest normalized score)

### Preserve Top Results Mode

When `preserveTopResults = true`, the ranking algorithm:

1. Keeps the original top result (first from SearXNG) at position 1
2. Filters remaining results by score
3. Takes up to 9 next-best results, sorted by reranker score
4. Appends remaining filtered results

This mode ensures the original top result is never displaced by the reranker, while still improving the ordering of subsequent results.

## Integration with Search Pipeline

The search endpoint coordinates reranking in `searchEndpointServerHook.ts`:

```
1. fetchSearXNG(query, searchType, limit) - internally fetches from SearXNG, deduplicates, and cleans results
2. Check getRerankerStatus()
   - If healthy: rankSearchResults(query, results, preserveTopResults)
   - If unhealthy: return unranked results (fallback)
3. Return structured JSON response
```

Reranking is applied to both text and image search results. For image results, titles and URLs are reformatted into the same text-tuple shape used for text search before being sent through the reranker, then the original image data (including thumbnails) is re-matched to the reranked order by URL. The only difference is that text search passes `preserveTopResults: true` to keep the original top SearXNG result pinned, while image search does not.

## Model Details

| Property | Value |
|----------|-------|
| Model | jina-reranker-v1-tiny-en |
| Format | GGUF (Q8_0 quantized) |
| HuggingFace Repo | Felladrin/gguf-jina-reranker-v1-tiny-en |
| Type | Cross-encoder reranker |
| Language | English |
| Storage | `server/models/Felladrin/gguf-jina-reranker-v1-tiny-en/` |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Reranker not ready | Falls back to unranked SearXNG results |
| Reranking API error | `isReady` set to `false`, process killed, auto-restart scheduled |
| Empty documents array | Returns empty array without calling reranker |
| Unicode sanitization needed | Logs warning, continues with sanitized input |
| Binary architecture mismatch | Logs `SIGTRAP`/`SIGILL` error with architecture details |

## Related Topics

- **Search System**: `docs/overview.md` - Search pipeline overview
- **Server Hooks**: `docs/overview.md#server-hook-system` - Hook registration
- **Web Search Service**: `server/webSearchService.ts` - SearXNG integration
