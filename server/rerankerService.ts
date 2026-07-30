import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Tokenizer } from "@huggingface/tokenizers";
import debug from "debug";
import { InferenceSession, Tensor } from "onnxruntime-node";
import { downloadFileFromHuggingFaceRepository } from "./downloadFileFromHuggingFaceRepository";

const fileName = path.basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

const MODEL_HF_REPO = "jinaai/jina-reranker-v1-tiny-en";
const MODEL_HF_FILE = "onnx/model.onnx";
const TOKENIZER_HF_FILE = "tokenizer.json";
const TOKENIZER_CONFIG_HF_FILE = "tokenizer_config.json";

/** From the model's config.json. */
const PAD_TOKEN_ID = 0;

/**
 * Sequence-length budget for one (query, document) pair, and the single point
 * where truncation happens now that rankSearchResults sends whole documents.
 * Left at 2048 rather than the tokenizer's declared `model_max_length` of 512,
 * matching the prior intent; see #2193.
 */
const MAX_SEQUENCE_LENGTH = 2048;

/**
 * onnxruntime-node wraps a synchronous native call, so a single large batch
 * blocks the event loop for its whole duration. Scoring in batches yields
 * between them, capping the stall at ~27ms instead of ~78ms for 30 results,
 * for about 4% more wall time. Scores are unaffected: padding is per batch but
 * the attention mask makes the result identical either way.
 */
const BATCH_SIZE = 10;

/**
 * ONNX Runtime execution providers to try first. WebGPU is roughly 3x faster
 * than CPU here and agrees with it to within float32 rounding, so it is
 * preferred when available. `coreml` is deliberately absent: it is slower than
 * CPU for this model's dynamic shapes.
 */
const PREFERRED_EXECUTION_PROVIDERS = ["webgpu", "cpu"];

/**
 * Trailing `cpu` in a provider list is not a fallback chain: ONNX Runtime only
 * falls back per operator, once a provider is registered. A provider that fails
 * to initialize at all (no GPU adapter, or no `libvulkan.so.1` for Dawn to
 * load, as on Hugging Face Spaces) rejects the whole session, so the CPU-only
 * session has to be a second attempt.
 */
const FALLBACK_EXECUTION_PROVIDERS = ["cpu"];

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

function createSession(modelPath: string, executionProviders: string[]) {
  printMessage(
    `Loading model (arch: ${process.arch}, platform: ${process.platform}, execution providers: ${executionProviders.join(", ")})...`,
  );

  return InferenceSession.create(modelPath, {
    executionProviders,
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

  try {
    session = await createSession(modelPath, PREFERRED_EXECUTION_PROVIDERS);
  } catch (error) {
    printMessage(
      `Could not load the model with ${PREFERRED_EXECUTION_PROVIDERS.join(", ")}: ${error instanceof Error ? error.message : error}`,
    );
    session = await createSession(modelPath, FALLBACK_EXECUTION_PROVIDERS);
  }

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

async function scoreBatch(
  activeSession: InferenceSession,
  encodings: number[][],
) {
  const paddedLength = Math.max(...encodings.map(({ length }) => length));
  const inputIds = new BigInt64Array(encodings.length * paddedLength);
  const attentionMask = new BigInt64Array(encodings.length * paddedLength);

  encodings.forEach((ids, row) => {
    const offset = row * paddedLength;
    for (let column = 0; column < paddedLength; column += 1) {
      const isPadding = column >= ids.length;
      inputIds[offset + column] = BigInt(
        isPadding ? PAD_TOKEN_ID : ids[column],
      );
      attentionMask[offset + column] = isPadding ? 0n : 1n;
    }
  });

  const dimensions = [encodings.length, paddedLength];
  const { logits } = await activeSession.run({
    input_ids: new Tensor("int64", inputIds, dimensions),
    attention_mask: new Tensor("int64", attentionMask, dimensions),
  });

  return Array.from(logits.data as Float32Array, Number);
}

/**
 * Caps an encoded cross-encoder pair at `maxLength` tokens by dropping tokens
 * from the end of the document only. The sequence is `[CLS] query [SEP]
 * document [SEP]`, so the query sits at the front and is preserved, and the
 * trailing separator is kept so the model still receives a well-formed pair.
 * `tokenTypeIds` mark the query segment (0) apart from the document (1). This
 * mirrors the tokenizer's `only_second` truncation, which the JS package does
 * not implement. Falls back to a plain head slice if the query alone already
 * exceeds the budget.
 */
export function truncatePairTokens(
  ids: number[],
  tokenTypeIds: number[],
  maxLength: number,
): number[] {
  if (ids.length <= maxLength) {
    return ids;
  }

  const querySegmentLength = tokenTypeIds.filter((type) => type === 0).length;
  const documentBudget = maxLength - querySegmentLength - 1;

  if (documentBudget <= 0) {
    return ids.slice(0, maxLength);
  }

  const separator = ids[ids.length - 1];
  return [...ids.slice(0, querySegmentLength + documentBudget), separator];
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

  const encodings = documents.map((document) => {
    const { ids, token_type_ids } = loadedTokenizer.encode(query, {
      text_pair: document,
      return_token_type_ids: true,
    });
    return truncatePairTokens(ids, token_type_ids, MAX_SEQUENCE_LENGTH);
  });

  const scores: number[] = [];

  for (let offset = 0; offset < encodings.length; offset += BATCH_SIZE) {
    scores.push(
      ...(await scoreBatch(
        activeSession,
        encodings.slice(offset, offset + BATCH_SIZE),
      )),
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
