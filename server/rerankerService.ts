import fs from "node:fs";
import path from "node:path";
import type { Tokenizer } from "@huggingface/tokenizers";
import { type InferenceSession, Tensor } from "onnxruntime-node";
import { createModelLogger, loadOnnxModel } from "./utils/onnxModelLoader.ts";

const printMessage = createModelLogger(path.basename(import.meta.url));

const MODEL_HF_REPO = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1";

const PORTABLE_MODEL_HF_FILE = "onnx/model_quint8_avx2.onnx";

/**
 * The build for x64 hosts whose CPU has AVX512_VNNI. The repository ships one
 * build per CPU kernel family (`qint8_arm64`, `qint8_avx512`,
 * `qint8_avx512_vnni`, `quint8_avx2`) from the same weights. `quint8_avx2` is
 * the portable default, because unsigned activations sidestep the signed-int8
 * saturation that x64 without VNNI has to work around, and it measured no
 * slower than the arm64 build on arm64. Quantization costs nothing measurable:
 * 0.7992 against 0.7973 nDCG@10 for fp32 on 240 MIRACL queries, for a quarter
 * of the download and half the latency.
 *
 * On a VNNI host the signed int8 kernels have the saturating multiply-add they
 * need, so the saturation workaround is not paid for and the VNNI build runs
 * the same weights through faster kernels. The swap is score-neutral: the
 * qint8 builds score 0.8039 against the quint8 build's 0.7992 on the same set.
 */
const VNNI_MODEL_HF_FILE = "onnx/model_qint8_avx512_vnni.onnx";

/**
 * Parses the CPU feature flags out of `/proc/cpuinfo` content. Every online
 * processor gets its own `flags` line, and the lines are not always identical:
 * on an Intel hybrid CPU the E-cores lack instructions the P-cores have, so a
 * feature counts only when every line reports it. The intersection is the set
 * the scheduler cannot dodge. Returns null when no flags line is there, which
 * is the signal to keep the portable build rather than a guess at the
 * instruction set.
 */
export function parseCpuFlags(cpuinfo: string): string[] | null {
  const lines = [...cpuinfo.matchAll(/^flags[ \t]*:[ \t]*(.*)$/gm)];
  if (lines.length === 0) return null;

  const flagSets = lines.map((line) => new Set(line[1].split(/\s+/)));
  return [...flagSets[0]].filter((flag) =>
    flagSets.every((set) => set.has(flag)),
  );
}

/**
 * Reads the CPU feature flags from `/proc/cpuinfo`. Returns null when the file
 * is not there or unreadable, which is the signal to keep the portable build
 * rather than a guess at the instruction set.
 */
function readCpuFlags(): string[] | null {
  try {
    return parseCpuFlags(fs.readFileSync("/proc/cpuinfo", "utf8"));
  } catch {
    return null;
  }
}

/**
 * Picks the quantized build for this CPU: the VNNI build on a Linux x64 host
 * that reports `avx512_vnni`, the portable build everywhere else.
 */
export function selectModelFile(
  platform: string,
  arch: string,
  cpuFlags: string[] | null,
): string {
  return platform === "linux" &&
    arch === "x64" &&
    cpuFlags?.includes("avx512_vnni")
    ? VNNI_MODEL_HF_FILE
    : PORTABLE_MODEL_HF_FILE;
}

const MODEL_HF_FILE = selectModelFile(
  process.platform,
  process.arch,
  readCpuFlags(),
);

/**
 * Hard ceiling rather than a tuning knob: the model has 514 learned position
 * embeddings, two of which XLM-RoBERTa reserves, so a 513-token pair fails
 * outright with `indices element out of data bounds` at the position-embedding
 * gather. Still more generous than what shipped before #2260, which cut
 * documents to 512 characters upstream.
 */
const MAX_SEQUENCE_LENGTH = 512;

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

export async function startRerankerService() {
  printMessage(`Preparing model (${MODEL_HF_FILE})...`);
  const loaded = await loadOnnxModel(MODEL_HF_REPO, MODEL_HF_FILE);
  session = loaded.session;
  tokenizer = loaded.tokenizer;

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
