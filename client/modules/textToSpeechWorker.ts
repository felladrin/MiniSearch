/// <reference lib="webworker" />
import { predict } from "./piper";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./textToSpeechWorkerProtocol";

/**
 * Identifies the newest synthesis request. A request whose id is no longer
 * current stops posting, so a `stop` or a newer `speak` cannot be overwritten
 * by sentences the previous request was still synthesizing.
 */
let currentRequestId = 0;

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === "stop") {
    currentRequestId += 1;
    return;
  }

  currentRequestId += 1;
  const requestId = currentRequestId;

  try {
    for (const [index, sentence] of data.sentences.entries()) {
      if (requestId !== currentRequestId) return;

      const audio = await predict({ text: sentence, voiceId: data.voiceId });
      if (requestId !== currentRequestId) return;

      const buffer = await audio.arrayBuffer();
      if (requestId !== currentRequestId) return;

      post({ type: "audio", requestId, index, buffer }, [buffer]);
    }

    if (requestId === currentRequestId) post({ type: "done", requestId });
  } catch (error) {
    if (requestId !== currentRequestId) return;
    post({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
