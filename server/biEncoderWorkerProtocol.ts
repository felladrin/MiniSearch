/**
 * The messages `biEncoderService.ts` and `biEncoderWorker.ts` exchange, kept in
 * their own module so the main thread can name them without importing the
 * worker: importing that module would load the ~450 MB model into the very
 * thread the worker exists to keep free.
 *
 * Only plain data crosses the boundary. Embeddings stay inside the worker and
 * the cosine step runs there, so a scoring pass sends strings out and brings
 * `number[]` back rather than copying 384 floats per passage.
 */

/**
 * Rows per batched forward pass. The old chunk of 64 wrapped one-text-per-call
 * runs and bought no concurrency; now that a call really carries its rows, B
 * trades padding waste and cache pressure against per-call setup. B=64 measured
 * slower than the per-text path; the sweep cannot separate the two plausible
 * causes — a 64-row bucket spans a wider length range, so padding waste
 * grows, and at L=256 with 12 heads the attention score tensor alone is
 * ~192 MiB live, which pressures cache. B=16 (~48 MiB) measured fastest on
 * a 200-passage pool on this host (x86_64, 32 cpus): 1.88x wall time and a
 * 223ms worst event-loop block against 1560ms for the per-text path.
 */
export const BATCH_ROWS = 16;

/** Scoring work sent to the worker. `id` correlates the reply. */
export interface BiEncoderRequest {
  type: "score";
  id: number;
  query: string;
  passages: string[];
}

export type BiEncoderResponse =
  /** The model is loaded and warmed up; the worker accepts scoring now. */
  | { type: "ready" }
  | {
      type: "scores";
      id: number;
      scores: number[];
      /**
       * The `input_ids` dims of each forward pass this request ran, in run
       * order. The session no longer lives on the main thread, so this is the
       * only way a test can assert on the bucketing; it is a few pairs of
       * numbers per request.
       */
      runDimensions: number[][];
    }
  /** Scoring threw inside the worker. The service reads this as empty scores. */
  | { type: "failed"; id: number; message: string };
