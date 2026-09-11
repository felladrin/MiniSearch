/// <reference lib="webworker" />
import { predict } from "./piper";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./textToSpeechWorkerProtocol";

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    for (const [index, sentence] of data.sentences.entries()) {
      const audio = await predict({ text: sentence, voiceId: data.voiceId });
      const buffer = await audio.arrayBuffer();
      post({ type: "audio", index, buffer }, [buffer]);
    }
    post({ type: "done" });
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
