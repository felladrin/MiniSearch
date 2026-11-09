import type { Wllama } from "@wllama/wllama";
import { addLogEntry } from "./logEntries";
import { getSettings } from "./pubSub";
import { webGpuSupport } from "./webGpu";

/**
 * Which path can transcribe speech in this browser. `"wasm"` runs the
 * Qwen3-ASR model locally through wllama; `"web-speech"` falls back to the
 * browser's own `SpeechRecognition`, which sends audio to the vendor.
 */
export type DictationEngine = "wasm" | "web-speech";

export type DictationErrorKind = "permission" | "unavailable" | "engine";

export class DictationError extends Error {
  kind: DictationErrorKind;

  constructor(kind: DictationErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Qwen3-ASR 0.6B (Apache-2.0), pinned to a commit of the repository so an
 * upstream re-upload cannot change what users download. The browser fetches
 * it straight from Hugging Face, like the in-browser chat models, and wllama
 * keeps it in the origin's private file system after the first press.
 */
const DICTATION_MODEL_URL_PREFIX =
  "https://huggingface.co/mradermacher/Qwen3-ASR-0.6B-GGUF/resolve/39c0af5b4099296b922e9b61db2fce4317fe2d35/";

export const DICTATION_MODEL_SOURCE = {
  url: `${DICTATION_MODEL_URL_PREFIX}Qwen3-ASR-0.6B.Q4_K_M.gguf`,
  mmprojUrl: `${DICTATION_MODEL_URL_PREFIX}Qwen3-ASR-0.6B.mmproj-Q8_0.gguf`,
};

/** The sample rate Qwen3-ASR's audio encoder takes. */
const MODEL_SAMPLE_RATE = 16000;

/**
 * The recording ends on its own after this long, so the audio always fits
 * the context below. A search query or a follow-up question is far shorter.
 */
export const MAX_RECORDING_SECONDS = 120;

/**
 * Room for `MAX_RECORDING_SECONDS` of audio, the prompt and the transcript.
 * The audio encoder emits about 13 tokens per second of speech.
 */
const DICTATION_CONTEXT_SIZE = 4096;

/** The minimum the app needs from `window.SpeechRecognition`. */
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const candidate = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return (
    candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null
  );
}

/**
 * The engine that would run a dictation right now, or null when neither the
 * WASM path nor `SpeechRecognition` is available and the button should hide.
 *
 * `preferLocalModel` reorders the two engines; it never empties the list.
 * A user who turns the on-device model off on a browser without
 * `SpeechRecognition` (Firefox, for one) must still get a working Dictate
 * button, so the preference cannot be an exclusion.
 */
export function getDictationEngine(
  preferLocalModel: boolean,
): DictationEngine | null {
  // Neither engine can open a microphone outside a secure context. Without
  // this, a plain-HTTP LAN deployment falls through to `SpeechRecognition`,
  // which then reports `not-allowed` and tells the user permission was denied
  // when the real cause is the origin.
  if (typeof isSecureContext !== "undefined" && !isSecureContext) return null;
  const wasmCapable =
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function";
  const webSpeechAvailable = getSpeechRecognitionConstructor() !== null;
  if (preferLocalModel) {
    if (wasmCapable) return "wasm";
    return webSpeechAvailable ? "web-speech" : null;
  }
  if (webSpeechAvailable) return "web-speech";
  return wasmCapable ? "wasm" : null;
}

export interface DictationCallbacks {
  /**
   * Called with the whole dictated text so far. The browser's recognizer
   * calls it as the text grows; the on-device model calls it once, while
   * `stop()` is running, because it transcribes the recording as a whole.
   */
  onTranscript: (text: string) => void;
  /** Model download progress; `total` is undefined when sizes are unknown. */
  onProgress?: (loaded: number, total?: number) => void;
  /**
   * The local engine could not run and the browser's own recognizer took over.
   * That one sends audio to the browser vendor, so it is worth saying out loud.
   */
  onFallback?: () => void;
  /**
   * The engine stopped listening on its own, without failing: the browser's
   * recognizer ends after silence even with `continuous`, and the on-device
   * recording ends at `MAX_RECORDING_SECONDS`. The caller then calls `stop()`
   * to collect the transcript.
   */
  onEnd?: () => void;
  /**
   * A failure after the engine loaded. The load itself rejects instead, so
   * this is the channel for an engine that dies mid-dictation, which would
   * otherwise leave the UI listening forever with the microphone open, and for
   * a transcription that fails after `stop()`.
   */
  onError?: (error: DictationError) => void;
}

export interface DictationSession {
  /**
   * Stops listening and resolves once the transcript, if any, has been
   * delivered through `onTranscript`. Never rejects: a failure goes to
   * `onError`.
   */
  stop: () => Promise<void>;
  /**
   * Stops listening and drops whatever was not delivered yet. For a session
   * whose field is gone or read-only, where a late transcript has nowhere
   * to go.
   */
  cancel: () => void;
}

/**
 * Linear-interpolation resample to the 16 kHz mono PCM the model expects.
 * The capture rate depends on the sound device, so the conversion happens
 * here rather than assuming 16 kHz out of the AudioContext.
 */
export function resampleTo16k(
  input: Float32Array,
  inputRate: number,
): Float32Array {
  if (inputRate === 16000) return input;
  const ratio = inputRate / 16000;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const current = input[index] ?? 0;
    const next = input[Math.min(index + 1, input.length - 1)] ?? 0;
    output[i] = current * (1 - fraction) + next * fraction;
  }
  return output;
}

/**
 * Wraps mono samples in a 16-bit PCM WAV file, the container wllama's
 * transcription decodes.
 */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const headerSize = 44;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(headerSize + i * 2, Math.round(sample * 0x7fff), true);
  }
  return buffer;
}

/**
 * Qwen3-ASR opens its answer with the language it detected, as in
 * `language English<asr_text>The text.`; only the text belongs in the field.
 */
export function stripLanguageTag(output: string): string {
  return output.replace(/^\s*language[^<]*<asr_text>/, "").trim();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Frees the model's memory; a failure here is logged, never thrown. */
async function releaseModel(wllama: Wllama): Promise<void> {
  try {
    await wllama.exit();
  } catch (error) {
    addLogEntry(`The dictation model did not unload: ${describeError(error)}`);
  }
}

async function loadDictationModel(
  callbacks: DictationCallbacks,
  signal?: AbortSignal,
): Promise<Wllama> {
  const { createWllamaInstance } = await import("./wllama");
  const wllama = await createWllamaInstance({
    suppressNativeLog: true,
    allowOffline: true,
  });
  const abandon = () => {
    void releaseModel(wllama);
    return new DictationError("engine", "Dictation was cancelled");
  };
  // Even from the cache, the load takes seconds a gone button cannot use.
  if (signal?.aborted) throw abandon();
  try {
    await wllama.loadModelFromUrl(DICTATION_MODEL_SOURCE, {
      n_ctx: DICTATION_CONTEXT_SIZE,
      n_threads: getSettings().cpuThreads,
      n_gpu_layers: (await webGpuSupport) ? 99999 : 0,
      progressCallback: ({ loaded, total }) =>
        callbacks.onProgress?.(loaded, total),
      signal,
    });
  } catch (error) {
    void releaseModel(wllama);
    throw new DictationError(
      "engine",
      `The dictation model could not be loaded: ${describeError(error)}`,
    );
  }
  // The abort only reaches the download; once the files are in, the load in
  // the worker runs to the end, and the model is dropped here instead.
  if (signal?.aborted) throw abandon();
  return wllama;
}

async function startWasmDictation(
  callbacks: DictationCallbacks,
  signal?: AbortSignal,
): Promise<DictationSession> {
  const wllama = await loadDictationModel(callbacks, signal);

  // Only once the model is ready: opening it first would light the browser's
  // recording indicator for the whole of a first-run download.
  let mediaStream: MediaStream;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    void releaseModel(wllama);
    throw new DictationError(
      "permission",
      `The microphone could not be opened: ${describeError(error)}`,
    );
  }
  // Abandoned while the permission prompt was open.
  if (signal?.aborted) {
    mediaStream.getTracks().forEach((track) => {
      track.stop();
    });
    void releaseModel(wllama);
    throw new DictationError("engine", "Dictation was cancelled");
  }

  const chunks: Float32Array[] = [];
  let recordedSamples = 0;
  const maxSamples = MAX_RECORDING_SECONDS * MODEL_SAMPLE_RATE;
  /** Cleared once the microphone is released, by `stop`, `cancel` or the cap. */
  let listening = true;
  let cancelled = false;
  const transcription = new AbortController();

  let audioContext: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;

  const releaseAudio = () => {
    if (!listening) return;
    listening = false;
    processor?.disconnect();
    source?.disconnect();
    mediaStream.getTracks().forEach((track) => {
      track.stop();
    });
    audioContext?.close().catch((error: unknown) => {
      addLogEntry(
        `The dictation audio context did not close: ${describeError(error)}`,
      );
    });
  };

  // Asking for 16 kHz lets the browser resample properly. `resampleTo16k` is
  // the fallback for devices that refuse the rate: its linear interpolation
  // has no lowpass, so everything above 8 kHz aliases into the band the model
  // listens to.
  try {
    const context = new AudioContext({ sampleRate: MODEL_SAMPLE_RATE });
    audioContext = context;
    source = context.createMediaStreamSource(mediaStream);
    // A 1-channel ScriptProcessor downmixes stereo capture to mono, which
    // matters for devices whose microphone sits on the right channel only.
    // 1024 samples, because the block being filled when the user stops is
    // lost: 64 ms of the last word instead of 256 ms with 4096.
    processor = context.createScriptProcessor(1024, 1, 1);

    processor.onaudioprocess = (event) => {
      // The processor must stay connected to the destination to be called;
      // zero the output so the microphone is not played back through the
      // speakers.
      event.outputBuffer.getChannelData(0).fill(0);
      if (!listening) return;
      const input = event.inputBuffer.getChannelData(0);
      const resampled = resampleTo16k(input, context.sampleRate);
      // The capture buffer is reused for the next block, so the untouched
      // path needs a copy. `resampleTo16k` already returned a fresh array.
      const chunk = (
        resampled === input ? new Float32Array(input) : resampled
      ).subarray(0, maxSamples - recordedSamples);
      chunks.push(chunk);
      recordedSamples += chunk.length;
      if (recordedSamples >= maxSamples) {
        releaseAudio();
        callbacks.onEnd?.();
      }
    };

    source.connect(processor);
    processor.connect(context.destination);
  } catch (error) {
    // `new AudioContext({ sampleRate })` throws when the rate is refused, and
    // Chrome throws once a page holds too many live contexts. Escaping here as
    // a plain Error would be caught as "the local engine cannot run" and hand
    // the microphone to the browser's cloud recognizer by accident.
    releaseAudio();
    void releaseModel(wllama);
    throw new DictationError(
      "engine",
      `The audio pipeline could not be started: ${describeError(error)}`,
    );
  }

  const transcribe = async () => {
    const samples = new Float32Array(recordedSamples);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    chunks.length = 0;
    // Nothing was captured when stop comes right after the press.
    if (samples.length === 0) return;
    const result = await wllama.createTranscription({
      file: encodeWav(samples, MODEL_SAMPLE_RATE),
      abortSignal: transcription.signal,
    });
    const text = stripLanguageTag(result.text);
    if (!cancelled && text) callbacks.onTranscript(text);
  };

  const finish = async () => {
    releaseAudio();
    try {
      await transcribe();
    } catch (error) {
      if (!cancelled) {
        callbacks.onError?.(
          new DictationError(
            "engine",
            `The recording could not be transcribed: ${describeError(error)}`,
          ),
        );
      }
    } finally {
      await releaseModel(wllama);
    }
  };

  /**
   * Shared by every caller, so a second `stop` (the user pressing while the
   * cap ends the recording) waits for the same transcript instead of
   * resolving before it lands.
   */
  let stopping: Promise<void> | null = null;

  return {
    stop: () => {
      if (cancelled) return Promise.resolve();
      stopping ??= finish();
      return stopping;
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      releaseAudio();
      transcription.abort();
      // Unloading terminates wllama's worker at once, so a running
      // transcription stops using the CPU now instead of at its next check of
      // the signal. The `finally` in `finish` then unloads it a second time,
      // which wllama treats as a no-op.
      void releaseModel(wllama);
    },
  };
}

function startWebSpeechDictation(
  callbacks: DictationCallbacks,
): Promise<DictationSession> {
  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) {
    return Promise.reject(
      new DictationError("unavailable", "No dictation engine is available"),
    );
  }

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language;

  let finalText = "";
  /** The returned promise has resolved, so rejecting it would be a no-op. */
  let resolved = false;
  // `recognition.stop()` emits one last `result` by spec, and the caller has
  // already forgotten what it appended by then.
  let stopped = false;

  return new Promise<DictationSession>((resolve, reject) => {
    recognition.onresult = (event) => {
      if (stopped) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      // Collapsed because the final text and the interim chunk each may or may
      // not carry their own spacing, and a search query wants one space.
      callbacks.onTranscript(
        `${finalText} ${interim}`.replace(/\s+/g, " ").trim(),
      );
    };

    recognition.onerror = (event) => {
      if (stopped) return;
      const denied =
        event.error === "not-allowed" || event.error === "service-not-allowed";
      const failure = denied
        ? new DictationError(
            "permission",
            "Microphone permission was denied for dictation",
          )
        : new DictationError("engine", `Dictation failed: ${event.error}`);
      // `start()` does not throw on a denial: the error arrives later, by which
      // point this promise has already resolved and rejecting it is a no-op.
      // Everything after the resolve therefore goes through `onError`.
      if (resolved) callbacks.onError?.(failure);
      else reject(failure);
    };

    recognition.onend = () => {
      if (stopped) return;
      // The recognizer ends on its own after silence even with `continuous`.
      // That is not a failure worth a notification, but the session is over, so
      // the button has to come back from Listening.
      if (resolved) {
        callbacks.onEnd?.();
        return;
      }
      reject(new DictationError("engine", "Dictation ended before any speech"));
    };

    try {
      recognition.start();
      resolved = true;
      // The recognizer delivers its text as it goes, so stopping it and
      // dropping its last result is all either one needs to do.
      const end = () => {
        stopped = true;
        recognition.stop();
      };
      resolve({ stop: async () => end(), cancel: end });
    } catch (error) {
      reject(
        new DictationError(
          "unavailable",
          `Dictation could not start: ${describeError(error)}`,
        ),
      );
    }
  });
}

/**
 * Starts dictating. Resolves once the microphone is open (and, on the WASM
 * path, the model is loaded); rejects with a `DictationError` whose `kind`
 * tells the caller whether the user denied permission or the engine failed.
 *
 * `signal` abandons a session that is still loading: the model download
 * stops, the microphone never opens, and nothing falls back.
 */
export async function startDictation(
  callbacks: DictationCallbacks,
  preferLocalModel: boolean,
  signal?: AbortSignal,
): Promise<DictationSession> {
  const engine = getDictationEngine(preferLocalModel);
  if (engine === "wasm") {
    try {
      return await startWasmDictation(callbacks, signal);
    } catch (error) {
      // Abandoned: falling back would open the vendor's recognizer for a
      // button that is gone.
      if (signal?.aborted) throw error;
      // A denied microphone is the user's answer, not an engine that cannot
      // run, so it is reported rather than retried on a path that would ask
      // again and, in Chrome, ship the audio to the browser vendor.
      if (error instanceof DictationError && error.kind === "permission")
        throw error;
      if (!getSpeechRecognitionConstructor()) throw error;
      addLogEntry(
        `Local dictation failed, falling back to the browser's recognizer: ${describeError(error)}`,
      );
      // The user pressed a button documented as on-device, so the switch to a
      // recognizer that ships audio to the browser vendor is announced.
      callbacks.onFallback?.();
      return startWebSpeechDictation(callbacks);
    }
  }
  if (engine === "web-speech") {
    // No reverse fallback to wasm when this recognizer fails. Falling through
    // would start a ~700 MB model download right after the user turned that
    // model off; a clear failure is the better answer, and it matches what
    // web-speech-only browsers already do.
    return startWebSpeechDictation(callbacks);
  }
  addLogEntry("Dictation is not available in this browser");
  throw new DictationError(
    "unavailable",
    "This browser cannot dictate a search query",
  );
}
