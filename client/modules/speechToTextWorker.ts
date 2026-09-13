/// <reference lib="webworker" />
import { AssetDownloader, ModelArch, Transcriber } from "./moonshine";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./speechToTextWorkerProtocol";

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

/**
 * Lines keyed by their opaque id, in the order they first appeared, so the
 * transcript is the join of the map's values. Completed lines keep their final
 * text; only the in-progress line changes.
 */
const lines = new Map<string, string>();

function emitTranscript() {
  post({ type: "transcript", text: [...lines.values()].join(" ").trim() });
}

let transcriber: Transcriber | null = null;

async function load(modelFiles: Record<string, string>): Promise<void> {
  const downloader = new AssetDownloader({
    cacheName: "minisearch-dictation",
    onProgress: (loaded, total) => post({ type: "progress", loaded, total }),
  });

  transcriber = await Transcriber.loadFromUrls(modelFiles, {
    modelArch: ModelArch.TinyStreaming,
    downloader,
  });

  transcriber.addListener({
    onLineStarted: (event) => {
      lines.set(event.line.id, event.line.text);
      emitTranscript();
    },
    onLineTextChanged: (event) => {
      lines.set(event.line.id, event.line.text);
      emitTranscript();
    },
    onLineCompleted: (event) => {
      lines.set(event.line.id, event.line.text);
      emitTranscript();
    },
    onError: (event) => {
      post({
        type: "error",
        message: event.error?.message ?? "Dictation failed",
      });
    },
  });

  transcriber.start();
  post({ type: "loaded" });
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === "load") {
      await load(data.modelFiles);
      return;
    }
    if (data.type === "audio") {
      transcriber?.addAudio(
        new Float32Array(data.buffer),
        data.sampleRate,
        undefined,
      );
      return;
    }
    try {
      transcriber?.stop();
    } finally {
      // Always acknowledged: without this the main thread waits out its whole
      // timeout before terminating a worker that already gave up.
      post({ type: "stopped" });
    }
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
