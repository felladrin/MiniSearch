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

1. Downloads the model and tokenizer from HuggingFace if not present (`cross-encoder/mmarco-mMiniLMv2-L12-H384-v1`)
2. Creates an ONNX Runtime inference session
3. Performs a warmup inference (`query: "test"`, `documents: ["test document"]`) to ensure the graph is initialized
4. Sets `isReady = true`

There is no child process, port, or health endpoint: inference runs inside the Node process.

### Model Cache Integrity

`downloadFileFromHuggingFaceRepository` compares each cached file against the size the Hub reports, so a file downloaded only in part is replaced instead of being loaded. Without that check a truncated model made every later startup fail with `Protobuf parsing failed`, and only deleting `server/models/` by hand recovered.

Downloads land on a sibling `.part-<pid>` path and are renamed once the whole body is on disk, which keeps an interrupted write from being visible where the next startup would trust it. Files are also checked individually, so a missing tokenizer is fetched on its own while the 119MB model stays cached.

The size check costs one metadata request per file at startup (roughly 600ms for the three of them). When the Hub is unreachable the cached files are used as they are, so an offline server still starts with a warm cache.

### Execution Providers

The session is created with `["cpu"]`, with no configuration to set, and there is no second attempt to fall back from.

The model ships as a dynamically quantized graph, and the WebGPU provider has no kernels for its integer matmuls. It registers happily and then hands every one of them back to the CPU, paying a round trip each time: 812ms against 172ms of the same work, with scores drifting by as much as 1.15 and reordering results. GPU acceleration is therefore not on the table for this model, which also removes the reason the two-attempt session logic existed.

| Provider | Availability in the Node binding | Notes |
|----------|----------------------------------|-------|
| `cpu` | Everywhere | The only provider used |
| `webgpu` | Windows, Linux x64, macOS | Not used: no integer-matmul kernels, so a quantized graph runs ~4.7x slower than on CPU and its scores drift |
| `cuda` | Linux x64 (CUDA v12) | Not used: the binaries are not bundled, and would need `npm install onnxruntime-node --onnxruntime-node-install=cuda12` |
| `coreml` | macOS | Not used: slower than CPU for this model's dynamic shapes |

### One Document per Call

Documents are scored one at a time rather than in batches, which is what keeps a score a property of its own `(query, document)` pair.

Dynamic quantization computes each activation tensor's scale from that tensor's own range at runtime. Padding rows out to a shared width puts the pad positions inside that range, and while the attention mask keeps them out of attention it cannot keep them out of the scale, so the quantization of the real tokens shifts. Batches of 10 moved logits by up to 1.29 at ordinary snippet lengths and reordered 2 of 10 fixtures depending only on which documents shared a batch. The fp32 export of the same model shows a difference of exactly zero, so this is a property of quantization and not of the graph.

Scoring one pair at a time removes the padding, and with it the coupling. It also suits the reason batching was introduced in the first place: `onnxruntime-node` wraps a synchronous native call, and one pair holds the event loop for about 13ms instead of the 50ms a batch of 10 takes. The cost is throughput, roughly 12% more wall time for 30 documents on two threads and up to 47% more where there are cores to spare.

### Shutdown

On server close, `stopRerankerService()` clears the readiness flag and releases the inference session.

## Health Monitoring

`getRerankerStatus()` reports whether the model finished loading. The search endpoint checks it before attempting ranking and falls back to unranked SearXNG results if the reranker is unavailable.

## Reranking Process

### Document Preparation

Each result is formatted as `` `${title}\n${snippet}` ``: the cased title and snippet on either side of a newline, with no URL. The query keeps its original casing too. Unicode surrogates in both are sanitized before tokenization.

Documents are sent to the reranker whole. Truncation happens by tokens inside the reranker, not by characters here: `score()` caps each encoded `(query, document)` pair at `MAX_SEQUENCE_LENGTH` tokens, dropping tokens from the end of the document only, so the query and the trailing separator are preserved.

`MAX_SEQUENCE_LENGTH` is 512 because the model has 514 learned position embeddings and XLM-RoBERTa reserves two of them. It is a limit, not a preference: a 513-token pair fails outright with `indices element out of data bounds` at the position-embedding gather. Web snippets land around 33-63 tokens per pair, so truncation is rare in practice.

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
| Model | mmarco-mMiniLMv2-L12-H384-v1 |
| Format | ONNX, dynamically quantized (`onnx/model_quint8_avx2.onnx`, 119MB) |
| HuggingFace Repo | cross-encoder/mmarco-mMiniLMv2-L12-H384-v1 |
| Type | Cross-encoder reranker (XLM-RoBERTa, one relevance logit) |
| Size | 12 layers, 118M parameters, of which 96M are the 250k-token vocabulary |
| Max sequence length | 512 tokens, the model's own limit, enforced via `MAX_SEQUENCE_LENGTH` |
| Storage | `server/models/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1/` |

It is trained on mMARCO, the machine-translated multilingual MS MARCO, and is genuinely multilingual: a 250k-token sentencepiece vocabulary shared across languages, which is also where most of the parameter count goes.

The model it replaced, `jina-reranker-v1-tiny-en`, was chosen on the belief that an English model ranked other languages well enough. Measured against 240 MIRACL queries across English, Spanish, French, German, Russian and Japanese, it scored 0.4636 nDCG@10, below the 0.4963 of the un-reranked first-stage order: on non-English content it was not adding ranking signal. This model scores 0.7992 on the same set. Part of the mechanism is the tokenizer, since an English WordPiece vocabulary spends 2.17x as many tokens on Russian and about 1.4x on Spanish, German and Japanese, so the English model paid more compute to see worse-fragmented subwords.

### Choosing the Quantized Export

The repository ships one build per CPU kernel family from the same weights: `qint8_arm64`, `qint8_avx512`, `qint8_avx512_vnni` and `quint8_avx2`. `quint8_avx2` is the one used, because unsigned activations sidestep the signed-int8 saturation that x64 without VNNI otherwise has to work around, and it measured no slower than the arm64 build when run on arm64. The `qint8_arm64` and `qint8_avx512` builds are bit-identical in output and score 0.8039, marginally above `quint8_avx2`, but that margin is inside the noise of a 240-query set and does not buy predictable behaviour on hosts whose instruction set cannot be known in advance.

Quantization costs nothing measurable here: 0.7992 against 0.7973 nDCG@10 for the fp32 export, for a quarter of the download and half the latency. That is a different conclusion from the one that held for the previous 33M-parameter model, where the `q8` export did measurably degrade ranking; the loss does not carry over to a model with 12 layers and a large embedding table.

The `O4` (fp16) export loads without complaint but is slower than fp32 on CPU, so it is not used either.

## Testing

`server/rerankerService.test.ts` runs in the default suite and covers Unicode sanitization, token truncation, and that every document is sent as its own unpadded row, with the ONNX Runtime session, the tokenizer, and the model download all mocked.

`server/rerankerService.integration.test.ts` loads the real model and asserts ranking quality against English and Portuguese fixtures. It downloads ~136MB, the model plus a 17MB sentencepiece tokenizer, so it is excluded from the default suite:

```sh
npx vitest run --config vitest.integration.config.ts
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Reranker not ready | Falls back to unranked SearXNG results |
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
