import type { VoiceId } from "./piper";

/** Messages exchanged with `textToSpeechWorker`, shared by both sides. */

export type WorkerRequest =
  | { type: "speak"; sentences: string[]; voiceId: VoiceId }
  | { type: "stop" };

export type WorkerResponse =
  | { type: "audio"; requestId: number; index: number; buffer: ArrayBuffer }
  | { type: "done"; requestId: number }
  | { type: "error"; requestId: number; message: string };
