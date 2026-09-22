// @vitest-environment node

/**
 * Exercises the real bi-encoder end to end. Downloads ~460MB on first run, so
 * it is excluded from the default suite:
 *
 *   npx vitest run --config vitest.integration.config.ts biEncoder
 */

import { monitorEventLoopDelay } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import type { Tokenizer } from "@huggingface/tokenizers";
import { type InferenceSession, Tensor } from "onnxruntime-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getBiEncoderStatus,
  scorePassages,
  startBiEncoderService,
  stopBiEncoderService,
} from "./biEncoderService";
import {
  BATCH_ROWS,
  type BiEncoderRequest,
  type BiEncoderResponse,
} from "./biEncoderWorkerProtocol";
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

    // Sanity: the fixture actually exercised the comparison rather than
    // matching an all-zero result — real magnitude and real spread. An
    // all-zero or all-equal score vector fails here.
    const maxAbsScore = Math.max(...batchedScores.map((s) => Math.abs(s)));
    expect(maxAbsScore).toBeGreaterThan(0.1);
    expect(new Set(batchedScores).size).toBeGreaterThan(1);
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

/**
 * Runs one scoring request against a worker of its own and returns its reply.
 *
 * The session lives in the worker now, so a `session.run` spy on this thread
 * would see nothing. The worker reports the dims of each forward pass instead,
 * which is what the bucketing assertions read.
 */
async function scoreInOwnWorker(
  query: string,
  passages: string[],
): Promise<Extract<BiEncoderResponse, { type: "scores" }>> {
  const worker = new Worker(new URL("./biEncoderWorker.ts", import.meta.url));

  try {
    await new Promise<void>((resolve, reject) => {
      worker.once("message", (message: BiEncoderResponse) => {
        if (message.type === "ready") resolve();
        else reject(new Error(`Expected "ready", got "${message.type}"`));
      });
      worker.once("error", reject);
    });

    return await new Promise((resolve, reject) => {
      worker.once("message", (message: BiEncoderResponse) => {
        if (message.type === "scores") resolve(message);
        else if (message.type === "failed") reject(new Error(message.message));
      });
      worker.once("error", reject);

      const request: BiEncoderRequest = {
        type: "score",
        id: 1,
        query,
        passages,
      };
      worker.postMessage(request);
    });
  } finally {
    await worker.terminate();
  }
}

describe("biEncoderWorker bucketing (#2715, #2730)", () => {
  it("runs one forward pass per length bucket, not one per passage", async () => {
    // Zigzag lengths with the sort's guarantee removed: bucket 1's last
    // row (190 words) is longer than bucket 2's last row (25 words), so
    // an unsorted pass sets bucket widths from those rows and they come
    // out decreasing — the non-decreasing-width assertion below then
    // fails. With the sort, widths are non-decreasing by construction.
    const wordCounts = [
      200, 10, 150, 5, 180, 20, 120, 8, 90, 160, 30, 110, 60, 140, 190, 170, 15,
      130, 70, 25,
    ];
    const passages = wordCounts.map((n, i) => makePassage(n, i));

    const { scores, runDimensions } = await scoreInOwnWorker(
      "how do alpha bravo passages score",
      passages,
    );

    expect(scores).toHaveLength(passages.length);

    // The query rides in the batch, so 21 rows go through ceil(21 / B)
    // bucketed runs instead of 21 per-passage runs.
    const expectedBuckets = Math.ceil((passages.length + 1) / BATCH_ROWS);
    expect(runDimensions.length).toBe(expectedBuckets);
    expect(runDimensions.length).toBeLessThan(passages.length + 1);

    let totalRows = 0;
    for (const dims of runDimensions) {
      expect(dims.length).toBe(2);
      expect(dims[0]).toBeLessThanOrEqual(BATCH_ROWS);
      totalRows += dims[0];
    }
    expect(totalRows).toBe(passages.length + 1);

    // Every non-final bucket is full, so it really carries multiple rows.
    // Only the final bucket may be short — with BATCH_ROWS of 10 or 20 a
    // 21-row pool leaves it exactly one row, so the >1 check must not
    // depend on the tuning knob.
    for (let i = 0; i < runDimensions.length - 1; i++) {
      expect(runDimensions[i][0]).toBeGreaterThan(1);
    }

    // Bucket widths are non-decreasing across runs: the sort by token
    // length put the short rows first. Delete the `.sort()` in encodeBatch
    // and this fails.
    for (let i = 1; i < runDimensions.length; i++) {
      expect(runDimensions[i][1]).toBeGreaterThanOrEqual(
        runDimensions[i - 1][1],
      );
    }
  });
});

describe("biEncoderService main-thread cost (#2730)", () => {
  beforeAll(async () => {
    await startBiEncoderService();
  });

  afterAll(async () => {
    await stopBiEncoderService();
  });

  /**
   * The acceptance measurement from #2730. On the main thread the same pass
   * blocked for ~815 ms (x86_64, 32 logical cores); with the session in the
   * worker it measures ~1.5 ms. The bar is left at the issue's 20 ms so the
   * test reports a regression rather than host-to-host noise.
   */
  it("keeps the main-thread event-loop block under 20 ms for a 200-passage pass", async () => {
    const passages = Array.from({ length: 200 }, (_, i) =>
      makePassage(5 + ((i * 37) % 300), i),
    );
    const query = "how do alpha bravo passages score";

    // One untimed pass, so the worker's lazily allocated arenas are not
    // charged to the measurement.
    await scorePassages(query, passages.slice(0, 20));

    const histogram = monitorEventLoopDelay({ resolution: 1 });
    histogram.enable();
    const scores = await scorePassages(query, passages);
    histogram.disable();

    expect(scores).toHaveLength(passages.length);
    expect(histogram.max / 1e6).toBeLessThan(20);
  });
});

describe("biEncoderService when the worker goes away (#2730)", () => {
  it("answers in-flight scoring with empty scores and reports not ready", async () => {
    await startBiEncoderService();
    expect(await getBiEncoderStatus()).toBe(true);

    const passages = Array.from({ length: 200 }, (_, i) =>
      makePassage(5 + ((i * 37) % 300), i),
    );
    // Fired but not awaited: the worker is taken away underneath it. An
    // unanswered request would hang the page-content read that made it, so
    // it has to come back empty, which is the signal to rank lexically.
    const pending = scorePassages(
      "how do alpha bravo passages score",
      passages,
    );
    await stopBiEncoderService();

    await expect(pending).resolves.toEqual([]);
    expect(await getBiEncoderStatus()).toBe(false);
    expect(await scorePassages("query", ["one"])).toEqual([]);
  });
});
