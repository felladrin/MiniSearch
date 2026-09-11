import type { VoiceId } from "./piper";

/**
 * Messages exchanged with `textToSpeechWorker`, shared by both sides.
 *
 * Each playback gets its own worker and stops it with `terminate()`, so there
 * is no cancel message and no need for the worker to tell requests apart.
 */

export interface WorkerRequest {
  sentences: string[];
  voiceId: VoiceId;
}

export type WorkerResponse =
  | { type: "audio"; index: number; buffer: ArrayBuffer }
  | { type: "done" }
  | { type: "error"; message: string };
