import path from "node:path";
import type { Tokenizer } from "@huggingface/tokenizers";
import { type InferenceSession, Tensor } from "onnxruntime-node";
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
 * Rows per batched forward pass. The old chunk of 64 wrapped one-text-per-call
 * runs and bought no concurrency; now that a call really carries its rows, the
 * attention score tensor scales with B — at B=64, L=256, 12 heads it is
 * ~192 MiB live, which thrashes cache (measured slower than the per-text
 * path). B=16 keeps it ~48 MiB and measured fastest on a 200-passage pool
 * on this host (x86_64, 32 cpus): 1.88x wall time and a 223ms worst
 * event-loop block against 1560ms for the per-text path.
 */
export const BATCH_ROWS = 16;

let isReady = false;
let session: InferenceSession | null = null;
let tokenizer: Tokenizer | null = null;
let padTokenId: number | null = null;

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
 */
async function encodeBatch(
  activeSession: InferenceSession,
  loadedTokenizer: Tokenizer,
  activePadTokenId: number,
  texts: string[],
): Promise<Float32Array[]> {
  const tokenized = texts
    .map((text, index) => ({
      index,
      ids: loadedTokenizer.encode(text).ids.slice(0, MAX_SEQUENCE_LENGTH),
    }))
    .sort((a, b) => a.ids.length - b.ids.length);

  const embeddings: Float32Array[] = new Array(texts.length);

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

    const { last_hidden_state } = await activeSession.run({
      input_ids: new Tensor("int64", inputIds, dimensions),
      attention_mask: new Tensor("int64", attentionMask, dimensions),
      token_type_ids: new Tensor("int64", tokenTypeIds, dimensions),
    });

    const hidden = last_hidden_state.data as Float32Array;
    const dim = last_hidden_state.dims[2];

    for (let row = 0; row < rows.length; row++) {
      // Right-padding keeps every real token inside `ids.length`, so pooling
      // over that count never touches a pad. (Checking the mask here instead
      // would have to compare against 0n: BigInt64Array entries are never
      // `=== 0`.)
      const rowLength = rows[row].ids.length;
      const pooled = new Float32Array(dim);
      for (let t = 0; t < rowLength; t++) {
        const offset = (row * bucketLength + t) * dim;
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

  return embeddings;
}

/**
 * Encodes a single text into a normalized embedding vector.
 */
async function encode(
  activeSession: InferenceSession,
  loadedTokenizer: Tokenizer,
  activePadTokenId: number,
  text: string,
): Promise<Float32Array> {
  const [embedding] = await encodeBatch(
    activeSession,
    loadedTokenizer,
    activePadTokenId,
    [text],
  );
  return embedding;
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

export async function startBiEncoderService() {
  printMessage("Preparing bi-encoder model...");
  const loaded = await loadOnnxModel(MODEL_HF_REPO, MODEL_HF_FILE);
  if (loaded.padTokenId === null) {
    throw new Error(
      `The bi-encoder tokenizer (${MODEL_HF_REPO}) declares no pad_token; batched scoring needs the real pad id and will not assume one`,
    );
  }
  session = loaded.session;
  tokenizer = loaded.tokenizer;
  padTokenId = loaded.padTokenId;

  // Warm up with a test encoding.
  await encode(session, tokenizer, padTokenId, "test query");

  isReady = true;
  printMessage("Bi-encoder service ready!");
}

export async function stopBiEncoderService() {
  isReady = false;
  const currentSession = session;
  session = null;
  tokenizer = null;
  padTokenId = null;
  await currentSession?.release();
}

export async function getBiEncoderStatus() {
  return isReady;
}

/**
 * Returns dense (semantic) scores for passages given a query.
 * Falls back to empty array when the model is not loaded.
 */
export async function scorePassages(
  query: string,
  passages: string[],
): Promise<number[]> {
  if (!session || !tokenizer || padTokenId === null || passages.length === 0) {
    return [];
  }

  const activeSession = session;
  const loadedTokenizer = tokenizer;
  const activePadTokenId = padTokenId;

  // The query rides in the same batched pass as the passages instead of
  // running alone: it is short, lands in the shortest bucket after the
  // length sort, and saves one forward pass.
  const [queryEmbedding, ...passageEmbeddings] = await encodeBatch(
    activeSession,
    loadedTokenizer,
    activePadTokenId,
    [query, ...passages],
  );

  return cosineSimilarities(queryEmbedding, passageEmbeddings);
}
