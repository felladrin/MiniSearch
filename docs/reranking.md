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

### Model Cache Integrity

`downloadFileFromHuggingFaceRepository` compares each cached file against the size the Hub reports, so a file downloaded only in part is replaced instead of being loaded. Without that check a truncated model made every later startup fail with `Protobuf parsing failed`, and only deleting `server/models/` by hand recovered.

Downloads land on a sibling `.part-<pid>` path and are renamed once the whole body is on disk, which keeps an interrupted write from being visible where the next startup would trust it. Files are also checked individually, so a missing tokenizer is fetched on its own while the 130MB model stays cached.

The size check costs one metadata request per file at startup (roughly 600ms for the three of them). When the Hub is unreachable the cached files are used as they are, so an offline server still starts with a warm cache.

### Execution Providers

The session is created with `["webgpu", "cpu"]`, with no configuration to set. WebGPU is roughly 3x faster than CPU (24ms against 77ms for 30 documents) and agrees with it to within float32 rounding (1e-6, identical ordering), so it is preferred where it works.

When that session fails to be created, the reason is logged and a second session is created with `["cpu"]`. The retry is what makes hosts without a GPU work: a trailing `cpu` in the provider list is not a fallback chain, because ONNX Runtime only falls back per operator once a provider has been registered. A provider that fails to initialize at all rejects `InferenceSession.create` outright, and the entries behind it never get a chance. On Hugging Face Spaces, for instance, Dawn cannot find `libvulkan.so.1`, WebGPU then reports `No supported adapters`, and before the retry existed that left the reranker permanently unready with every search falling back to unranked results. The providers of each attempt are logged.

Note that ONNX Runtime's WebGPU provider here is native, part of the `onnxruntime-node` binary. It is not the browser API, so it needs neither a browser nor Deno.

| Provider | Availability in the Node binding | Notes |
|----------|----------------------------------|-------|
| `cpu` | Everywhere | Fallback, retried as its own session |
| `webgpu` | Windows, Linux x64, macOS | Preferred; experimental in ONNX Runtime, and needs a real GPU adapter plus a Vulkan loader on Linux |
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

Each result is formatted as `` `${title}\n${snippet}` ``: the cased title and snippet on either side of a newline, with no URL. The query keeps its original casing too. Unicode surrogates in both are sanitized before tokenization.

Documents are sent to the reranker whole. Truncation happens by tokens inside the reranker, not by characters here: `score()` caps each encoded `(query, document)` pair at `MAX_SEQUENCE_LENGTH` tokens, dropping tokens from the end of the document only, so the query and the trailing separator are preserved.

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
| Max sequence length | 8192 tokens (ALiBi); capped at 2048 via `MAX_SEQUENCE_LENGTH` |
| Storage | `server/models/jinaai/jina-reranker-v1-tiny-en/` |

Despite being an English model, it ranks non-English results (Portuguese, for example) well in practice, which is why it is preferred over larger alternatives.

Quantized variants are deliberately not used. The `q8` export measurably degrades ranking quality on this 33M-parameter model, and the `fp16` export fails to load in `onnxruntime-node`.

## Testing

`server/rerankerService.test.ts` runs in the default suite and covers Unicode sanitization plus the execution-provider fallback, with the ONNX Runtime session, the tokenizer, and the model download all mocked.

`server/rerankerService.integration.test.ts` loads the real model and asserts ranking quality against English and Portuguese fixtures. It downloads ~130MB, so it is excluded from the default suite:

```sh
npx vitest run --config vitest.integration.config.ts
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Reranker not ready | Falls back to unranked SearXNG results |
| GPU provider unavailable | Logged, then the session is created again with `["cpu"]` |
| Model fails to load | Logged by the hook; reranker stays unready and search returns unranked results |
| Cached file of the wrong size | Logged, then downloaded again before the session is created |
| Download shorter than the reported size | Throws before anything is written, so the cache keeps no partial file |
| HuggingFace unreachable with a warm cache | Metadata failure is logged and the cached files are used unchanged |
| Empty documents array | Returns empty array without running inference |
| Unicode sanitization needed | Logs warning, continues with sanitized input |

## Related Topics

- **Search System**: `docs/overview.md` - Search pipeline overview
- **Server Hooks**: `docs/overview.md#server-hook-system` - Hook registration
- **Web Search Service**: `server/webSearchService.ts` - SearXNG integration
