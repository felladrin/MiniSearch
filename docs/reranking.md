# Search Result Reranking

MiniSearch optionally reranks search results using a cross-encoder model running in-process via ONNX Runtime. This secondary search stage reorders initial SearXNG results based on their semantic relevance to the user's query.

## Architecture Overview

The reranking subsystem consists of three components:

| Component | File | Responsibility |
|-----------|------|----------------|
| Service Manager | `server/rerankerService.ts` | Model loading, readiness state, reranking inference |
| Ranking Logic | `server/rankSearchResults.ts` | Score-based filtering and result reordering |
| Server Hook | `server/rerankerServiceHook.ts` | Startup/shutdown coordination with Vite server |

## Service Lifecycle

### Startup

The `rerankerServiceHook` starts the reranker during server initialization:

1. Downloads the model and tokenizer from HuggingFace if not present (`jinaai/jina-reranker-v1-tiny-en`)
2. Creates an ONNX Runtime inference session
3. Performs a warmup inference (`query: "test"`, `documents: ["test document"]`) to ensure the graph is initialized
4. Sets `isReady = true`

There is no child process, port, or health endpoint: inference runs inside the Node process.

### Execution Providers

The session requests `["webgpu", "cpu"]`, with no configuration to set. WebGPU is roughly 3x faster than CPU (24ms against 77ms for 30 documents) and agrees with it to within float32 rounding (1e-6, identical ordering), so it is preferred where it works. Listing `cpu` after it means hosts without a usable GPU provider fall back rather than failing to load. The list is logged at startup.

Note that ONNX Runtime's WebGPU provider here is native, part of the `onnxruntime-node` binary. It is not the browser API, so it needs neither a browser nor Deno.

| Provider | Availability in the Node binding | Notes |
|----------|----------------------------------|-------|
| `cpu` | Everywhere | Fallback |
| `webgpu` | Windows, Linux x64, macOS | Preferred; experimental in ONNX Runtime |
| `cuda` | Linux x64 (CUDA v12) | Not used: the binaries are not bundled, and would need `npm install onnxruntime-node --onnxruntime-node-install=cuda12` |
| `coreml` | macOS | Not used: slower than CPU for this model's dynamic shapes |

There is no GPU provider for Linux arm64, so those hosts always run on CPU.

### Batching

Documents are scored in batches of 10. `onnxruntime-node` wraps a synchronous native call, so scoring all 30 results at once would block the event loop for the full duration. Batching yields between calls, capping the stall at roughly 27ms rather than 78ms, at the cost of about 4% more wall time. Scores are identical either way, because padding is per batch but the attention mask excludes it.

### Shutdown

On server close, `stopRerankerService()` clears the readiness flag and releases the inference session.

## Health Monitoring

`getRerankerStatus()` reports whether the model finished loading. The search endpoint checks it before attempting ranking and falls back to unranked SearXNG results if the reranker is unavailable.

## Reranking Process

### Document Preparation

Search results are formatted as Markdown-style strings and truncated:

```typescript
const doc = `[${title}](${url} "${snippet}")`.toLocaleLowerCase();
// Truncated to MAX_DOCUMENT_LENGTH (512 characters)
```

Both query and documents are lowercased and Unicode surrogates are sanitized before tokenization.

### Unicode Sanitization

`sanitizeUnicodeSurrogates()` validates Unicode surrogate pairs in input strings. Invalid surrogates are replaced with the Unicode replacement character (`�`). This prevents failures when processing malformed UTF-8 from web search results.

### Scoring and Filtering

The reranker returns the classifier's raw relevance logit for each document. Scores are deliberately not passed through a sigmoid, because the filter below is calibrated against the raw scale. Results are then filtered using a two-stage statistical approach:

1. **Score Normalization**: Scores are shifted to positive range by adding the absolute value of the minimum score
2. **Standard Deviation Filter**: Results below `mean - kStandardDeviationFactor * standardDeviation` are filtered out
   - `kStandardDeviationFactor = 0.3`
3. **Percentage Fallback**: If fewer than 40% of results pass the standard deviation filter, a fallback threshold is applied:
   - `minPercentageFallback = 0.4` (40% of the highest normalized score)

This filter is invariant to linear rescaling of the scores, since both the scores and the threshold scale together.

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
| Format | ONNX (fp32) |
| HuggingFace Repo | jinaai/jina-reranker-v1-tiny-en |
| Type | Cross-encoder reranker |
| Size | 4 layers, 33M parameters |
| Storage | `server/models/jinaai/jina-reranker-v1-tiny-en/` |

Despite being an English model, it ranks non-English results (Portuguese, for example) well in practice, which is why it is preferred over larger alternatives.

Quantized variants are deliberately not used. The `q8` export measurably degrades ranking quality on this 33M-parameter model, and the `fp16` export fails to load in `onnxruntime-node`.

## Testing

`server/rerankerService.integration.test.ts` loads the real model and asserts ranking quality against English and Portuguese fixtures. It downloads ~130MB, so it is excluded from the default suite:

```sh
npx vitest run --config vitest.integration.config.ts
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Reranker not ready | Falls back to unranked SearXNG results |
| Model fails to load | Logged by the hook; reranker stays unready and search returns unranked results |
| Empty documents array | Returns empty array without running inference |
| Unicode sanitization needed | Logs warning, continues with sanitized input |

## Related Topics

- **Search System**: `docs/overview.md` - Search pipeline overview
- **Server Hooks**: `docs/overview.md#server-hook-system` - Hook registration
- **Web Search Service**: `server/webSearchService.ts` - SearXNG integration
