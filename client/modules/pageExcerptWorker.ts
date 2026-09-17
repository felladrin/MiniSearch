/// <reference lib="webworker" />
import { allocatePageExcerpts } from "./pageExcerptAllocation";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./pageExcerptWorkerProtocol";

/**
 * Answers one allocation request with the worker's response message.
 *
 * Exported as a plain function so the handler can be tested directly under
 * jsdom - no bundler, no live worker - and so the worker's answer is
 * provably the same computation the synchronous fallback runs.
 */
export function handleExcerptRequest(data: WorkerRequest): WorkerResponse {
  try {
    return {
      type: "excerpts",
      excerpts: allocatePageExcerpts(data.contents, data.tokenBudget),
    };
  } catch (error) {
    return {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  self.postMessage(handleExcerptRequest(data));
};
