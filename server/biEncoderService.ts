/**
 * The main thread's side of the bi-encoder. It owns no model and runs no
 * inference: it spawns `biEncoderWorker.ts`, forwards scoring requests to it
 * and matches the replies back to their callers.
 *
 * The four exported functions keep the signatures they had when the session
 * lived here, so no caller changed. What changed is that a scoring pass no
 * longer stops the event loop: a 200-passage pool blocked the main thread for
 * ~815 ms before and stays under 20 ms now (see docs/page-content.md).
 */

import path from "node:path";
import { Worker } from "node:worker_threads";
import type {
  BiEncoderRequest,
  BiEncoderResponse,
} from "./biEncoderWorkerProtocol.ts";
import { createModelLogger } from "./utils/onnxModelLoader.ts";

const printMessage = createModelLogger(path.basename(import.meta.url));

let worker: Worker | null = null;
let isReady = false;
let nextRequestId = 0;

/** Resolvers for requests the worker has not answered yet, keyed by their id. */
const pendingScores = new Map<number, (scores: number[]) => void>();

/**
 * Answers every in-flight request with empty scores. Empty is the signal
 * `pageContentService` already reads as "dense scoring is unavailable, rank
 * lexically", so a worker that dies degrades the ranking instead of leaving
 * page-content reads waiting for a reply that is never coming.
 */
function resolvePendingEmpty() {
  for (const resolve of pendingScores.values()) resolve([]);
  pendingScores.clear();
}

/**
 * Drops a worker that died. Guarded on identity because a terminated worker's
 * `exit` still arrives after `startBiEncoderService` has installed its
 * replacement, and that late event must not mark the new one dead.
 */
function forgetWorker(deadWorker: Worker) {
  if (worker !== deadWorker) return;
  worker = null;
  isReady = false;
  resolvePendingEmpty();
}

export async function startBiEncoderService() {
  if (worker) await stopBiEncoderService();

  const biEncoderWorker = new Worker(
    new URL("./biEncoderWorker.ts", import.meta.url),
  );
  worker = biEncoderWorker;

  biEncoderWorker.on("message", (message: BiEncoderResponse) => {
    if (message.type === "ready") return;

    const resolve = pendingScores.get(message.id);
    if (!resolve) return;
    pendingScores.delete(message.id);

    if (message.type === "failed") {
      printMessage(`Bi-encoder scoring failed: ${message.message}`);
      resolve([]);
      return;
    }

    resolve(message.scores);
  });

  biEncoderWorker.on("error", (error) => {
    printMessage(`Bi-encoder worker failed: ${error.message}`);
    forgetWorker(biEncoderWorker);
  });

  biEncoderWorker.on("exit", () => forgetWorker(biEncoderWorker));

  await new Promise<void>((resolve, reject) => {
    const stopListening = () => {
      biEncoderWorker.off("message", onMessage);
      biEncoderWorker.off("error", onError);
      biEncoderWorker.off("exit", onExit);
    };
    const onMessage = (message: BiEncoderResponse) => {
      if (message.type !== "ready") return;
      stopListening();
      resolve();
    };
    const onError = (error: Error) => {
      stopListening();
      reject(error);
    };
    const onExit = (code: number) => {
      stopListening();
      reject(
        new Error(
          `The bi-encoder worker exited with code ${code} before it was ready`,
        ),
      );
    };

    biEncoderWorker.on("message", onMessage);
    biEncoderWorker.on("error", onError);
    biEncoderWorker.on("exit", onExit);
  });

  isReady = true;
  printMessage("Bi-encoder service ready!");
}

export async function stopBiEncoderService() {
  const runningWorker = worker;
  isReady = false;
  worker = null;
  resolvePendingEmpty();
  await runningWorker?.terminate();
}

export async function getBiEncoderStatus() {
  return isReady;
}

/**
 * Returns dense (semantic) scores for passages given a query.
 * Falls back to empty array when the worker is not running.
 */
export async function scorePassages(
  query: string,
  passages: string[],
): Promise<number[]> {
  const runningWorker = worker;
  if (!runningWorker || !isReady || passages.length === 0) {
    return [];
  }

  // Ids are per-process and monotonic because the service can have several
  // scoring passes in flight at once: two concurrent page-content reads each
  // send their own request, and the replies can come back in either order.
  const id = nextRequestId++;

  return new Promise<number[]>((resolve) => {
    pendingScores.set(id, resolve);

    const request: BiEncoderRequest = { type: "score", id, query, passages };
    try {
      runningWorker.postMessage(request);
    } catch (error) {
      // The worker was terminated between the check above and this send.
      pendingScores.delete(id);
      printMessage(
        `Could not reach the bi-encoder worker: ${error instanceof Error ? error.message : String(error)}`,
      );
      resolve([]);
    }
  });
}
