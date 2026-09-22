// @vitest-environment node

/**
 * Exercises the real bi-encoder end to end. Downloads ~460MB on first run, so
 * it is excluded from the default suite:
 *
 *   npx vitest run --config vitest.integration.config.ts biEncoder
 */

import type { Tokenizer } from "@huggingface/tokenizers";
import { InferenceSession, Tensor } from "onnxruntime-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BATCH_ROWS,
  getBiEncoderStatus,
  scorePassages,
  startBiEncoderService,
  stopBiEncoderService,
} from "./biEncoderService";
import { loadOnnxModel } from "./utils/onnxModelLoader";

const MODEL_HF_REPO =
  "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";
const MODEL_HF_FILE = "onnx/model.onnx";
const MAX_SEQUENCE_LENGTH = 256;

const WORDS =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu".split(
    " ",
  );

/** Deterministic passage of `wordCount` words, distinct per `seed`. */
function makePassage(wordCount: number, seed: number): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(WORDS[(i * 7 + seed * 13) % WORDS.length]);
  }
  return words.join(" ");
}

/**
 * The per-text path this change replaced: one `session.run()` per text,
 * `[1, L]` tensors, mean pooling over the tokenizer's own mask. Kept here as
 * the reference the batched path must match.
 */
async function encodePerText(
  refSession: InferenceSession,
  refTokenizer: Tokenizer,
  text: string,
): Promise<Float32Array> {
  const { ids, attention_mask } = refTokenizer.encode(text);
  const truncatedIds = ids.slice(0, MAX_SEQUENCE_LENGTH);
  const truncatedMask = attention_mask.slice(0, MAX_SEQUENCE_LENGTH);
  const length = truncatedIds.length;
  const dimensions = [1, length];

  const { last_hidden_state } = await refSession.run({
    input_ids: new Tensor(
      "int64",
      BigInt64Array.from(truncatedIds, BigInt),
      dimensions,
    ),
    attention_mask: new Tensor(
      "int64",
      BigInt64Array.from(truncatedMask, BigInt),
      dimensions,
    ),
    token_type_ids: new Tensor("int64", new BigInt64Array(length), dimensions),
  });

  const embedding = last_hidden_state.data as Float32Array;
  const dim = last_hidden_state.dims[2];
  const pooled = new Float32Array(dim);
  let count = 0;

  for (let t = 0; t < length; t++) {
    if (truncatedMask[t] === 0) continue;
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

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let d = 0; d < a.length; d++) {
    sum += a[d] * b[d];
  }
  return sum;
}

describe("biEncoderService", () => {
  beforeAll(async () => {
    await startBiEncoderService();
  });

  afterAll(async () => {
    await stopBiEncoderService();
  });

  it("reports itself ready", async () => {
    expect(await getBiEncoderStatus()).toBe(true);
  });

  it("scores a relevant passage above an unrelated one", async () => {
    const [relevant, unrelated] = await scorePassages(
      "how to bake sourdough bread at home",
      [
        "Mix the starter with flour and water, let the dough rise overnight, then bake it in a hot Dutch oven.",
        "Antarctica has no permanent residents and its ice sheet holds most of the planet's fresh water.",
      ],
    );

    expect(relevant).toBeGreaterThan(unrelated);
    expect(relevant).toBeGreaterThan(0.3);
  });

  it("matches across languages", async () => {
    const [portuguese, unrelated] = await scorePassages(
      "what is the capital of France",
      [
        "A capital da França é Paris, situada às margens do rio Sena.",
        "Bubble sort repeatedly swaps adjacent elements until the list is ordered.",
      ],
    );

    expect(portuguese).toBeGreaterThan(unrelated);
  });

  it("returns one score per passage", async () => {
    const scores = await scorePassages("query", ["one", "two", "three"]);

    expect(scores).toHaveLength(3);
    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(-1.001);
      expect(score).toBeLessThanOrEqual(1.001);
    }
  });
});

describe("biEncoderService batched scoring (#2715)", () => {
  let refSession: InferenceSession;
  let refTokenizer: Tokenizer;

  beforeAll(async () => {
    // The first describe's afterAll stopped the service; these tests need it
    // running again, alongside a second session used as the per-text
    // reference.
    await startBiEncoderService();
    const loaded = await loadOnnxModel(MODEL_HF_REPO, MODEL_HF_FILE);
    refSession = loaded.session;
    refTokenizer = loaded.tokenizer;
  });

  afterAll(async () => {
    await stopBiEncoderService();
    await refSession?.release();
  });

  it("runs one forward pass per length bucket, not one per passage", async () => {
    const passages = Array.from({ length: 20 }, (_, i) =>
      makePassage(5 + i * 12, i),
    );

    // The typings expose `InferenceSession` as a factory interface and hide
    // the class prototype, but at runtime `run` is a prototype method, so a
    // prototype spy intercepts the service's already-created session.
    const sessionClass = InferenceSession as unknown as {
      prototype: { run: InferenceSession["run"] };
    };
    const runSpy = vi.spyOn(sessionClass.prototype, "run");
    await scorePassages("how do alpha bravo passages score", passages);
    // Capture before mockRestore: restoring also resets the call history.
    const runDims = runSpy.mock.calls.map(
      ([feeds]) =>
        (feeds as unknown as { input_ids: { dims: number[] } }).input_ids.dims,
    );
    runSpy.mockRestore();

    // The query rides in the batch, so 21 rows go through ceil(21 / B)
    // bucketed runs instead of 21 per-passage runs.
    const expectedBuckets = Math.ceil((passages.length + 1) / BATCH_ROWS);
    expect(runDims.length).toBe(expectedBuckets);
    expect(runDims.length).toBeLessThan(passages.length + 1);

    // Every run really carries multiple rows, and the rows add up to the
    // whole pool plus the query.
    let totalRows = 0;
    for (const dims of runDims) {
      expect(dims.length).toBe(2);
      expect(dims[0]).toBeGreaterThan(1);
      expect(dims[0]).toBeLessThanOrEqual(BATCH_ROWS);
      totalRows += dims[0];
    }
    expect(totalRows).toBe(passages.length + 1);
  });

  it("keeps batched scores within 1e-5 of the per-text path", async () => {
    const wordCounts = [
      3, 8, 15, 40, 90, 150, 250, 400, 5, 20, 60, 120, 200, 300, 12, 35, 75,
      175, 350, 7, 45, 110, 230, 9,
    ];
    const passages = wordCounts.map((n, i) => makePassage(n, i + 100));
    const query = "alpha bravo charlie delta echo";

    const batchedScores = await scorePassages(query, passages);

    const queryEmbedding = await encodePerText(refSession, refTokenizer, query);
    let maxAbsDiff = 0;
    for (let i = 0; i < passages.length; i++) {
      const passageEmbedding = await encodePerText(
        refSession,
        refTokenizer,
        passages[i],
      );
      const referenceScore = dot(queryEmbedding, passageEmbedding);
      maxAbsDiff = Math.max(
        maxAbsDiff,
        Math.abs(batchedScores[i] - referenceScore),
      );
      expect(Math.abs(batchedScores[i] - referenceScore)).toBeLessThan(1e-5);
    }

    // Sanity: the fixture actually exercised the tolerance rather than
    // comparing zeros.
    expect(batchedScores.every((s) => Number.isFinite(s))).toBe(true);
    expect(maxAbsDiff).toBeLessThan(1e-5);
  });

  it("returns scores in the original passage order, not the length-sorted order", async () => {
    // Deliberately out of length order: long, short, medium, short, long...
    const passages = [
      makePassage(220, 1),
      makePassage(4, 2),
      makePassage(60, 3),
      makePassage(6, 4),
      makePassage(180, 5),
      makePassage(40, 6),
      makePassage(5, 7),
      makePassage(140, 8),
      makePassage(3, 9),
      makePassage(300, 10),
    ];
    const query = "whiskey xray yankee zulu";

    const batchedScores = await scorePassages(query, passages);

    const queryEmbedding = await encodePerText(refSession, refTokenizer, query);
    for (let i = 0; i < passages.length; i++) {
      const passageEmbedding = await encodePerText(
        refSession,
        refTokenizer,
        passages[i],
      );
      const referenceScore = dot(queryEmbedding, passageEmbedding);
      // A permutation of the length-sorted order would miss by far more
      // than the padding tolerance.
      expect(Math.abs(batchedScores[i] - referenceScore)).toBeLessThan(1e-5);
    }

    // The fixture is non-monotonic in length, so the sorted order differs
    // from the input order and the check above is a real order test.
    const lengths = passages.map((p) => p.length);
    const isSorted = lengths.every(
      (len, i) => i === 0 || lengths[i - 1] <= len,
    );
    expect(isSorted).toBe(false);
  });
});
