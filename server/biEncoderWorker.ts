/**
 * The bi-encoder's ONNX session, running off the main thread.
 *
 * `onnxruntime-node` runs inference synchronously on whichever JS thread calls
 * it, so scoring a 200-passage pool used to stop the server's event loop for
 * hundreds of milliseconds — no other request could be served while a single
 * page-content read was ranking its passages. Here that work blocks only this
 * thread. The model is loaded here for the same reason: the ~450 MB of weights
 * must live in the worker's memory, not the main thread's.
 *
 * Node loads this file directly (type stripping), so keep it to syntax that
 * erases: no enums, no parameter properties, no namespaces.
 */

import { availableParallelism } from "node:os";
import path from "node:path";
import { parentPort } from "node:worker_threads";
import type { Tokenizer } from "@huggingface/tokenizers";
import { type InferenceSession, Tensor } from "onnxruntime-node";
import {
  BATCH_ROWS,
  type BiEncoderRequest,
  type BiEncoderResponse,
} from "./biEncoderWorkerProtocol.ts";
import { createModelLogger, loadOnnxModel } from "./utils/onnxModelLoader.ts";

const printMessage = createModelLogger(path.basename(import.meta.url));

const MODEL_HF_REPO =
  "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";

/**
 * The ONNX export. ~450 MB, multilingual (50+ languages), 384-dimensional
 * embeddings. CPU cost depends on passage length and pool size; the page-content
 * selector limits dense scoring to 256 passages. See docs/page-content.md.
 */
const MODEL_HF_FILE = "onnx/model.onnx";

/**
 * Maximum tokens per encoding. The model was trained with a 256-token limit;
 * passages longer than that are truncated from the end, which is where the
 * passage content sits after the query prefix.
 */
const MAX_SEQUENCE_LENGTH = 256;

/**
 * Half the reported parallelism, which is the physical core count on the
 * hyperthreaded x86 hosts this runs on, and at least one thread everywhere
 * else.
 *
 * ONNX Runtime otherwise sizes its intra-op pool from the logical core count
 * and its threads spin before yielding, so it oversubscribes every core and
 * leaves nothing for the thread that has to answer HTTP. Measured on a
 * 200-passage pool on this host (x86_64, 32 logical cores), worst main-thread
 * event-loop delay against wall time for the pass:
 *
 *   ORT default (32): 31-38 ms, 7.1 s
 *   16:                1-4 ms,  2.6 s
 *   8:                 1-2 ms,  4.2 s
 *   4:                 1-1 ms,  5.7 s
 *
 * Capping is not a trade here: 16 was both the quietest and the fastest, and
 * the oversubscribed default was the slowest setting measured.
 */
const INTRA_OP_THREADS = Math.max(1, Math.floor(availableParallelism() / 2));

interface EncodeResult {
  embeddings: Float32Array[];
  /** `input_ids` dims of each forward pass, in run order. */
  runDimensions: number[][];
}

/**
 * Encodes a batch of texts into normalized embedding vectors with one
 * `session.run()` per length bucket.
 *
 * Rows are sorted by token length and cut into buckets of at most
 * `BATCH_ROWS`, so each batch pads to its own near-uniform width instead of
 * the global max: attention is O(L^2), and padding a mixed-length chunk out
 * to 256 can multiply the FLOPs several-fold and come out slower than the
 * per-text path.
 *
 * Right-padding with the real pad id under an attention mask is score-safe for
 * this fp32 export: it has no per-tensor dynamic quantization scale, so a
 * padded row cannot move another row's scale, and the real tokens' hidden
 * states are bit-identical to encoding the text alone. (The cross-encoder is
 * dynamically quantized and cannot batch for that reason; see the note in
 * `rerankerService.ts`.)
 *
 * Buckets run one after another with a plain `await` — deliberately NOT a
 * `Promise.all` across buckets. Each await hands this thread's event loop a
 * turn between buckets, which is what lets two overlapping scoring requests
 * interleave instead of one waiting out the other. Do not "optimize" the
 * buckets back into a `Promise.all`: onnxruntime-node runs inference
 * synchronously on the calling thread regardless, so it would add no
 * concurrency while taking away those between-bucket turns.
 */
async function encodeBatch(
  activeSession: InferenceSession,
  loadedTokenizer: Tokenizer,
  activePadTokenId: number,
  texts: string[],
): Promise<EncodeResult> {
  const tokenized = texts
    .map((text, index) => {
      const { ids, attention_mask } = loadedTokenizer.encode(text);
      const slicedIds = ids.slice(0, MAX_SEQUENCE_LENGTH);
      const slicedMask = attention_mask.slice(0, MAX_SEQUENCE_LENGTH);
      // The real-token length comes from the mask's leading 1s, not from
      // trusting every returned id as real. At @huggingface/tokenizers
      // 0.2.0 the mask is all 1s, so this is a no-op today; it keeps the
      // row correct if a future tokenizer pads or marks truncation in the
      // mask (the cached tokenizer.json already declares a padding
      // strategy with pad_id 1).
      const firstPad = slicedMask.indexOf(0);
      const realLength = firstPad === -1 ? slicedIds.length : firstPad;
      return { index, ids: slicedIds.slice(0, realLength) };
    })
    .sort((a, b) => a.ids.length - b.ids.length);

  const embeddings: Float32Array[] = new Array(texts.length);
  const runDimensions: number[][] = [];

  for (let start = 0; start < tokenized.length; start += BATCH_ROWS) {
    const rows = tokenized.slice(start, start + BATCH_ROWS);
    // Sorted ascending, so the last row sets the bucket width.
    const bucketLength = rows[rows.length - 1].ids.length;
    const dimensions = [rows.length, bucketLength];

    const inputIds = new BigInt64Array(rows.length * bucketLength).fill(
      BigInt(activePadTokenId),
    );
    const attentionMask = new BigInt64Array(rows.length * bucketLength);
    // The export declares `token_type_ids` and ONNX Runtime refuses to run
    // with a declared input missing. Every text is one segment, so zeros.
    const tokenTypeIds = new BigInt64Array(rows.length * bucketLength);

    for (let row = 0; row < rows.length; row++) {
      const base = row * bucketLength;
      const { ids } = rows[row];
      for (let t = 0; t < ids.length; t++) {
        inputIds[base + t] = BigInt(ids[t]);
        attentionMask[base + t] = 1n;
      }
    }

    runDimensions.push(dimensions);

    const { last_hidden_state } = await activeSession.run({
      input_ids: new Tensor("int64", inputIds, dimensions),
      attention_mask: new Tensor("int64", attentionMask, dimensions),
      token_type_ids: new Tensor("int64", tokenTypeIds, dimensions),
    });

    const hidden = last_hidden_state.data as Float32Array;
    const dim = last_hidden_state.dims[2];
    // Take the row stride from the output tensor, not from the bucket
    // length we asked for: same value today, but the pooling can never
    // read the wrong row if the export's layout ever changes.
    const seqStride = last_hidden_state.dims[1];

    for (let row = 0; row < rows.length; row++) {
      // Right-padding keeps every real token inside `ids.length`, so
      // pooling over that count never touches a pad. (Checking the mask
      // here instead would have to compare against 0n: BigInt64Array
      // entries are never `=== 0`.)
      const rowLength = rows[row].ids.length;
      const pooled = new Float32Array(dim);
      for (let t = 0; t < rowLength; t++) {
        const offset = (row * seqStride + t) * dim;
        for (let d = 0; d < dim; d++) {
          pooled[d] += hidden[offset + d];
        }
      }
      if (rowLength > 0) {
        for (let d = 0; d < dim; d++) {
          pooled[d] /= rowLength;
        }
      }

      // L2 normalize.
      let norm = 0;
      for (let d = 0; d < dim; d++) {
        norm += pooled[d] * pooled[d];
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let d = 0; d < dim; d++) {
          pooled[d] /= norm;
        }
      }

      embeddings[rows[row].index] = pooled;
    }
  }

  return { embeddings, runDimensions };
}

/**
 * Computes cosine similarity between a query embedding and passage embeddings.
 * Both are assumed to be L2-normalized, so cosine similarity = dot product.
 */
function cosineSimilarities(
  query: Float32Array,
  passages: Float32Array[],
): number[] {
  return passages.map((passage) => {
    let sum = 0;
    for (let d = 0; d < query.length; d++) {
      sum += query[d] * passage[d];
    }
    return sum;
  });
}

if (!parentPort) {
  throw new Error(
    "biEncoderWorker.ts is a worker entry point and must be started with node:worker_threads",
  );
}

const port = parentPort;

printMessage("Preparing bi-encoder model...");
const loaded = await loadOnnxModel(MODEL_HF_REPO, MODEL_HF_FILE, {
  sessionOptions: { intraOpNumThreads: INTRA_OP_THREADS },
});
if (loaded.padTokenId === null) {
  throw new Error(
    `The bi-encoder tokenizer (${MODEL_HF_REPO}) declares no pad_token; batched scoring needs the real pad id and will not assume one`,
  );
}
const session = loaded.session;
const tokenizer = loaded.tokenizer;
const padTokenId = loaded.padTokenId;

// Warm up with a test encoding, so the first real request does not pay for
// the lazily allocated arenas of the first run.
await encodeBatch(session, tokenizer, padTokenId, ["test query"]);

port.on("message", async (request: BiEncoderRequest) => {
  if (request.type !== "score") return;

  try {
    // The query rides in the same batched pass as the passages instead of
    // running alone, saving one forward pass. Its position in the result is
    // guaranteed by the index-based restore inside encodeBatch
    // (`embeddings[rows[row].index]`), not by where the length sort happens
    // to place it, so it stays correct whatever the bucketing does.
    const { embeddings, runDimensions } = await encodeBatch(
      session,
      tokenizer,
      padTokenId,
      [request.query, ...request.passages],
    );
    const [queryEmbedding, ...passageEmbeddings] = embeddings;

    const response: BiEncoderResponse = {
      type: "scores",
      id: request.id,
      scores: cosineSimilarities(queryEmbedding, passageEmbeddings),
      runDimensions,
    };
    port.postMessage(response);
  } catch (error) {
    // The caller falls back to lexical ranking on empty scores, so one bad
    // request must not take the worker down with it.
    const response: BiEncoderResponse = {
      type: "failed",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    };
    port.postMessage(response);
  }
});

const ready: BiEncoderResponse = { type: "ready" };
port.postMessage(ready);
