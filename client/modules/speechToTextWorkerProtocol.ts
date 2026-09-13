/**
 * Messages exchanged with `speechToTextWorker`, shared by both sides.
 *
 * Each dictation session gets its own worker; the worker loads the model
 * (browser-cached after the first press), runs the transcriber, and reports
 * the growing transcript back.
 */

export type WorkerRequest =
  | {
      type: "load";
      /** Canonical model filename -> URL to fetch it from. */
      modelFiles: Record<string, string>;
    }
  | {
      type: "audio";
      /** Detached Float32 PCM buffer, mono. */
      buffer: ArrayBuffer;
      sampleRate: number;
    }
  | { type: "stop" };

export type WorkerResponse =
  | { type: "loaded" }
  | {
      type: "progress";
      /** Cumulative bytes fetched across the whole model. */
      loaded: number;
      /** Undefined when the sizes are unknown; render as indeterminate. */
      total?: number;
    }
  | {
      type: "transcript";
      /** Everything dictated so far, completed lines and the in-progress one. */
      text: string;
    }
  | { type: "error"; message: string };
