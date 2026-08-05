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

const MODEL_HF_REPO = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1";

/**
 * The dynamically quantized export. The repository ships one build per CPU
 * kernel family (`qint8_arm64`, `qint8_avx512`, `qint8_avx512_vnni`,
 * `quint8_avx2`) from the same weights; this one is the portable choice, because
 * unsigned activations sidestep the signed-int8 saturation that x64 without VNNI
 * has to work around, and it measured no slower than the arm64 build on arm64.
 * Quantization costs nothing measurable: 0.7992 against 0.7973 nDCG@10 for fp32
 * on 240 MIRACL queries, for a quarter of the download and half the latency.
 */
const MODEL_HF_FILE = "onnx/model_quint8_avx2.onnx";

const TOKENIZER_HF_FILE = "tokenizer.json";
const TOKENIZER_CONFIG_HF_FILE = "tokenizer_config.json";

/**
 * Hard ceiling rather than a tuning knob: the model has 514 learned position
 * embeddings, two of which XLM-RoBERTa reserves, so a 513-token pair fails
 * outright with `indices element out of data bounds` at the position-embedding
 * gather. Still more generous than what shipped before #2260, which cut
 * documents to 512 characters upstream.
 */
const MAX_SEQUENCE_LENGTH = 512;

/**
 * Only `cpu`. A dynamically quantized graph is the wrong shape for the WebGPU
 * provider, which has no kernels for the integer matmuls and shuttles every one
 * of them back to the CPU: 812ms against 172ms for the same work, with scores
 * drifting by up to 1.15 and reordering results. `coreml` is out for the same
 * reason it was before, being slower than CPU on dynamic shapes.
 */
const EXECUTION_PROVIDERS = ["cpu"];

let isReady = false;
let session: InferenceSession | null = null;
let tokenizer: Tokenizer | null = null;

/**
 * Sanitizes Unicode surrogate pairs in input string
 * @param input - String to sanitize
 * @returns Sanitized string with valid Unicode surrogates
 */
export function sanitizeUnicodeSurrogates(input: string) {
  let output = "";

  for (let i = 0; i < input.length; i += 1) {
    const codeUnit = input.charCodeAt(i);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit =
        i + 1 < input.length ? input.charCodeAt(i + 1) : undefined;
      if (
        nextCodeUnit !== undefined &&
        nextCodeUnit >= 0xdc00 &&
        nextCodeUnit <= 0xdfff
      ) {
        output += input[i];
        output += input[i + 1];
        i += 1;
      } else {
        output += "\ufffd";
      }
      continue;
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      output += "\ufffd";
      continue;
    }

    output += input[i];
  }

  return output;
}

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
    `Loading model (arch: ${process.arch}, platform: ${process.platform}, execution providers: ${EXECUTION_PROVIDERS.join(", ")})...`,
  );

  return InferenceSession.create(modelPath, {
    executionProviders: EXECUTION_PROVIDERS,
    // Errors only. ONNX Runtime otherwise warns on every startup that it
    // assigned shape operators to CPU, which is expected and not actionable.
    logSeverityLevel: 3,
  });
}

export async function startRerankerService() {
  printMessage("Preparing model...");

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

  await score("test", ["test document"]);

  isReady = true;
  printMessage("Service ready!");
}

export async function stopRerankerService() {
  isReady = false;
  const currentSession = session;
  session = null;
  tokenizer = null;
  await currentSession?.release();
}

export async function getRerankerStatus() {
  return isReady;
}

/**
 * Scores one pair on its own. Documents are deliberately not batched: this graph
 * quantizes activations dynamically, deriving the scale from each tensor's own
 * range, and padding rows out to a shared width puts the pad positions inside
 * that range even though the attention mask excludes them from attention. A
 * document's score then depends on which documents happen to sit beside it,
 * which moved logits by up to 1.29 and reordered 2 of 10 fixtures. One pair per
 * call has no padding to begin with, and it also holds the event loop for 13ms
 * at a time instead of 50ms, for about 12% more wall time on two threads.
 */
async function scoreDocument(
  activeSession: InferenceSession,
  ids: number[],
): Promise<number> {
  const dimensions = [1, ids.length];
  const { logits } = await activeSession.run({
    input_ids: new Tensor("int64", BigInt64Array.from(ids, BigInt), dimensions),
    attention_mask: new Tensor(
      "int64",
      new BigInt64Array(ids.length).fill(1n),
      dimensions,
    ),
  });

  return Number((logits.data as Float32Array)[0]);
}

/**
 * Caps an encoded cross-encoder pair at `maxLength` tokens by dropping tokens
 * from the end, which is where the document is: the sequence is `<s> query </s>
 * </s> document </s>`, so the query sits at the front and survives. The final
 * separator is carried over to the new end so the model still receives a
 * well-formed pair. This mirrors the tokenizer's `only_second` truncation, which
 * the JS package does not implement. The query segment is not read off
 * `token_type_ids`, because XLM-RoBERTa has a `type_vocab_size` of 1 and emits
 * zeros for the whole sequence.
 */
export function truncatePairTokens(ids: number[], maxLength: number): number[] {
  if (ids.length <= maxLength) {
    return ids;
  }

  return [...ids.slice(0, maxLength - 1), ids[ids.length - 1]];
}

/**
 * Returns the cross-encoder's raw relevance logit per document. Deliberately
 * not squashed through sigmoid: the standard-deviation filter in
 * rankSearchResults is calibrated against this scale.
 */
async function score(query: string, documents: string[]) {
  if (!session || !tokenizer) {
    throw new Error("Reranker model is not loaded");
  }

  const activeSession = session;
  const loadedTokenizer = tokenizer;

  const scores: number[] = [];

  for (const document of documents) {
    const { ids } = loadedTokenizer.encode(query, { text_pair: document });
    scores.push(
      await scoreDocument(
        activeSession,
        truncatePairTokens(ids, MAX_SEQUENCE_LENGTH),
      ),
    );
  }

  return scores;
}

export async function rerank(query: string, documents: string[]) {
  if (!documents || documents.length === 0) {
    return [];
  }

  if (!isReady) {
    throw new Error("Reranker service is not ready");
  }

  const sanitizedQuery = sanitizeUnicodeSurrogates(query);
  const sanitizedDocuments = documents.map(sanitizeUnicodeSurrogates);

  if (sanitizedQuery !== query) {
    printMessage(
      "Rerank query contained invalid Unicode surrogates; sanitized",
    );
  }

  if (sanitizedDocuments.some((doc, index) => doc !== documents[index])) {
    printMessage(
      "One or more rerank documents contained invalid Unicode surrogates; sanitized",
    );
  }

  const scores = await score(sanitizedQuery, sanitizedDocuments);

  return scores.map((relevance_score, index) => ({ index, relevance_score }));
}
