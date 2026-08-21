import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Tokenizer } from "@huggingface/tokenizers";
import debug from "debug";
import { InferenceSession, Tensor } from "onnxruntime-node";
import { downloadFileFromHuggingFaceRepository } from "./downloadFileFromHuggingFaceRepository.ts";

const fileName = path.basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

const MODEL_HF_REPO =
  "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";

/**
 * The ONNX export. ~450 MB, multilingual (50+ languages), 384-dimensional
 * embeddings. Fast enough for batched passage encoding: a batch of 64 passages
 * takes ~30 ms on CPU, well within the 20 s client timeout even for six pages
 * with hundreds of passages each.
 */
const MODEL_HF_FILE = "onnx/model.onnx";

const TOKENIZER_HF_FILE = "tokenizer.json";
const TOKENIZER_CONFIG_HF_FILE = "tokenizer_config.json";

/**
 * Maximum tokens per encoding. The model was trained with a 256-token limit;
 * passages longer than that are truncated from the end, which is where the
 * passage content sits after the query prefix.
 */
const MAX_SEQUENCE_LENGTH = 256;

/** Batch size for passage encoding. Larger batches speed up encoding but use
 * more memory; 64 is a safe default on CPU. */
const BATCH_SIZE = 64;

let isReady = false;
let session: InferenceSession | null = null;
let tokenizer: Tokenizer | null = null;

function resolveModelPath(hfRepoFile: string) {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "models",
    MODEL_HF_REPO,
    hfRepoFile,
  );
}

async function ensureFileExists(hfRepoFile: string) {
  const localPath = resolveModelPath(hfRepoFile);
  await downloadFileFromHuggingFaceRepository(
    MODEL_HF_REPO,
    hfRepoFile,
    localPath,
  );
  return localPath;
}

function createSession(modelPath: string) {
  printMessage(
    `Loading bi-encoder on CPU (arch: ${process.arch}, platform: ${process.platform})...`,
  );

  return InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    logSeverityLevel: 3,
  });
}

/**
 * Encodes a single text into a normalized embedding vector.
 */
async function encode(
  activeSession: InferenceSession,
  loadedTokenizer: Tokenizer,
  text: string,
): Promise<Float32Array> {
  const { ids } = loadedTokenizer.encode(text);
  const truncated =
    ids.length > MAX_SEQUENCE_LENGTH ? ids.slice(0, MAX_SEQUENCE_LENGTH) : ids;

  const length = truncated.length;
  const dimensions = [1, length];

  const { output } = await activeSession.run({
    input_ids: new Tensor(
      "int64",
      BigInt64Array.from(truncated as unknown as bigint[], BigInt),
      dimensions,
    ),
    attention_mask: new Tensor(
      "int64",
      BigInt64Array.from(
        (truncated as unknown as bigint[]).map((id) => (id !== 0n ? 1n : 0n)),
        BigInt,
      ),
      dimensions,
    ),
  });

  // Mean pooling: average the hidden states across non-padded tokens.
  const embedding = output.data as Float32Array;
  const dim = output.dims[2];
  const pooled = new Float32Array(dim);
  let count = 0;

  for (let t = 0; t < length; t++) {
    if ((truncated as unknown as bigint[])[t] === 0n) continue;
    const offset = t * dim;
    for (let d = 0; d < dim; d++) {
      pooled[d] += embedding[offset + d];
    }
    count++;
  }

  if (count > 0) {
    for (let d = 0; d < dim; d++) {
      pooled[d] /= count;
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

  return pooled;
}

/**
 * Encodes a batch of texts into normalized embedding vectors.
 */
async function encodeBatch(
  activeSession: InferenceSession,
  loadedTokenizer: Tokenizer,
  texts: string[],
): Promise<Float32Array[]> {
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((text) => encode(activeSession, loadedTokenizer, text)),
    );
    results.push(...batchResults);
  }

  return results;
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

  const [modelPath, tokenizerPath, tokenizerConfigPath] = await Promise.all([
    ensureFileExists(MODEL_HF_FILE),
    ensureFileExists(TOKENIZER_HF_FILE),
    ensureFileExists(TOKENIZER_CONFIG_HF_FILE),
  ]);

  tokenizer = new Tokenizer(
    JSON.parse(fs.readFileSync(tokenizerPath, "utf8")),
    JSON.parse(fs.readFileSync(tokenizerConfigPath, "utf8")),
  );

  session = await createSession(modelPath);

  // Warm up with a test encoding.
  await encode(session, tokenizer, "test query");

  isReady = true;
  printMessage("Bi-encoder service ready!");
}

export async function stopBiEncoderService() {
  isReady = false;
  const currentSession = session;
  session = null;
  tokenizer = null;
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
  if (!session || !tokenizer || passages.length === 0) {
    return [];
  }

  const activeSession = session;
  const loadedTokenizer = tokenizer;

  const queryEmbedding = await encode(activeSession, loadedTokenizer, query);
  const passageEmbeddings = await encodeBatch(
    activeSession,
    loadedTokenizer,
    passages,
  );

  return cosineSimilarities(queryEmbedding, passageEmbeddings);
}
