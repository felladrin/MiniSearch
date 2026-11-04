/**
 * Messages exchanged with `pageExcerptWorker`, shared by both sides.
 *
 * Each allocation gets its own worker, terminated as soon as the excerpts
 * come back, so there is no cancel message and no need for the worker to
 * tell requests apart.
 */

export interface WorkerRequest {
  /** Full body of every page read by `/page-content`, in result order. */
  contents: string[];
  /** Tokens the excerpts may occupy together. */
  tokenBudget: number;
  /**
   * The query the pages were read for, when known. The allocation uses it to
   * keep the part of a trimmed page that answers the query, so this decides
   * which lines the model reads.
   */
  query?: string;
}

export type WorkerResponse =
  | {
      type: "excerpts";
      /** One entry per request entry, same order; empty when a page got no share. */
      excerpts: string[];
    }
  | { type: "error"; message: string };
