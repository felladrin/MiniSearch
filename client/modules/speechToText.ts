import { DICTATION_MODELS_ROUTE_PREFIX } from "@shared/dictationModel";
import { addLogEntry } from "./logEntries";
import type { WorkerResponse } from "./speechToTextWorkerProtocol";

/**
 * Which path can transcribe speech in this browser. `"wasm"` runs the
 * Moonshine model locally in a worker; `"web-speech"` falls back to the
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
 * The streaming English model (MIT-licensed), served from this instance at
 * `/dictation-models/<file>` instead of the Moonshine CDN, so the page makes
 * no third-party requests. The filenames are the canonical ones the
 * streaming architecture loads; the server hook maps them to the pinned
 * upstream files and caches them on disk.
 */
const DICTATION_MODEL_FILES: Record<string, string> = Object.fromEntries(
  [
    "frontend.ort",
    "encoder.ort",
    "adapter.ort",
    "cross_kv.ort",
    "decoder_kv.ort",
    "streaming_config.json",
    "tokenizer.bin",
  ].map((file) => [file, `${DICTATION_MODELS_ROUTE_PREFIX}${file}`]),
);

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
  /** Called with the whole dictated text so far, as it grows. */
  onTranscript: (text: string) => void;
  /** Model download progress; `total` is undefined when sizes are unknown. */
  onProgress?: (loaded: number, total?: number) => void;
  /**
   * The local engine could not run and the browser's own recognizer took over.
   * That one sends audio to the browser vendor, so it is worth saying out loud.
   */
  onFallback?: () => void;
  /**
   * The engine stopped on its own, without failing. The browser's recognizer
   * ends after silence even with `continuous`, and the session is over once it
   * does.
   */
  onEnd?: () => void;
  /**
   * A failure after the engine loaded. The load itself rejects instead, so
   * this is the channel for a worker that dies mid-dictation, which would
   * otherwise leave the UI listening forever with the microphone open.
   */
  onError?: (error: DictationError) => void;
}

export interface DictationSession {
  stop: () => Promise<void>;
}

let workerFactory = () =>
  new Worker(new URL("./speechToTextWorker.ts", import.meta.url), {
    type: "module",
  });

/** Lets the tests supply a fake worker; the real one needs a bundler. */
export function setWorkerFactory(factory: () => Worker) {
  workerFactory = factory;
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function startWasmDictation(
  callbacks: DictationCallbacks,
): Promise<DictationSession> {
  const worker = workerFactory();
  /**
   * Set the moment `stop()` is entered. Every callback is gated on it: the
   * engines both emit one last result after being told to stop, and the button
   * has already forgotten what it appended by then, so an ungated late
   * transcript is appended a second time in full.
   */
  let stopped = false;

  /**
   * An engine failure between `loaded` and the microphone being granted. The
   * load promise has already settled by then, so rejecting it again is a no-op;
   * the permission prompt can sit open for minutes, and the transcriber is
   * already running and can die in that window.
   */
  let failureAfterLoad: DictationError | null = null;
  let engineLoaded = false;

  const loadEngine = () =>
    new Promise<void>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type === "loaded") {
          engineLoaded = true;
          resolve();
        } else if (data.type === "progress")
          callbacks.onProgress?.(data.loaded, data.total);
        else if (data.type === "error") {
          const failure = new DictationError("engine", data.message);
          if (engineLoaded) failureAfterLoad = failure;
          else reject(failure);
        }
      };
      worker.onerror = () => {
        const failure = new DictationError(
          "engine",
          "The dictation worker failed to start",
        );
        if (engineLoaded) failureAfterLoad = failure;
        else reject(failure);
      };
      worker.postMessage({ type: "load", modelFiles: DICTATION_MODEL_FILES });
    });

  try {
    await loadEngine();
  } catch (error) {
    worker.terminate();
    throw error;
  }

  // Only once the model is ready: opening it first would light the browser's
  // recording indicator for the whole of a first-run download.
  let mediaStream: MediaStream;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    worker.terminate();
    throw new DictationError(
      "permission",
      `The microphone could not be opened: ${describeError(error)}`,
    );
  }

  // Failed while the permission prompt was open. Thrown rather than reported
  // through `onError`, so it lands in `startDictation`'s catch and takes the
  // same fallback as any other engine failure.
  if (failureAfterLoad) {
    mediaStream.getTracks().forEach((track) => {
      track.stop();
    });
    worker.terminate();
    throw failureAfterLoad;
  }

  let acknowledgeStop: (() => void) | null = null;

  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    if (data.type === "stopped") {
      acknowledgeStop?.();
      return;
    }
    if (stopped) return;
    if (data.type === "transcript") callbacks.onTranscript(data.text);
    else if (data.type === "error")
      callbacks.onError?.(new DictationError("engine", data.message));
  };
  worker.onerror = () => {
    if (stopped) return;
    callbacks.onError?.(
      new DictationError("engine", "The dictation worker stopped unexpectedly"),
    );
  };

  // Asking for 16 kHz lets the browser resample properly. `resampleTo16k` is
  // the fallback for devices that refuse the rate: its linear interpolation
  // has no lowpass, so everything above 8 kHz aliases into the band the model
  // listens to.
  const releasePartialSession = (context?: AudioContext) => {
    mediaStream.getTracks().forEach((track) => {
      track.stop();
    });
    void context?.close();
    worker.terminate();
  };

  let audioContext: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  try {
    const context = new AudioContext({ sampleRate: 16000 });
    audioContext = context;
    source = context.createMediaStreamSource(mediaStream);
    // A 1-channel ScriptProcessor downmixes stereo capture to mono, which
    // matters for devices whose microphone sits on the right channel only.
    processor = context.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      if (stopped) return;
      const input = event.inputBuffer.getChannelData(0);
      const resampled = resampleTo16k(input, context.sampleRate);
      // The capture buffer is reused and a transferred buffer cannot be read
      // again, so the untouched path needs a copy. `resampleTo16k` already
      // returned a fresh array nobody else holds.
      const copy = resampled === input ? new Float32Array(input) : resampled;
      worker.postMessage(
        { type: "audio", buffer: copy.buffer, sampleRate: 16000 },
        [copy.buffer],
      );
      // The processor must stay connected to the destination to be called;
      // zero the output so the microphone is not played back through the
      // speakers.
      event.outputBuffer.getChannelData(0).fill(0);
    };

    source.connect(processor);
    processor.connect(context.destination);
  } catch (error) {
    // `new AudioContext({ sampleRate })` throws when the rate is refused, and
    // Chrome throws once a page holds too many live contexts. Escaping here as
    // a plain Error would be caught as "the local engine cannot run" and hand
    // the microphone to the browser's cloud recognizer by accident.
    releasePartialSession(audioContext);
    throw new DictationError(
      "engine",
      `The audio pipeline could not be started: ${describeError(error)}`,
    );
  }

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      processor?.disconnect();
      source?.disconnect();
      mediaStream.getTracks().forEach((track) => {
        track.stop();
      });

      // Wait for the transcriber to drain its queue, but never hang the UI on
      // a worker that has stopped answering.
      const acknowledged = new Promise<void>((resolve) => {
        acknowledgeStop = resolve;
      });
      worker.postMessage({ type: "stop" });
      await Promise.race([
        acknowledged,
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);

      try {
        await audioContext?.close();
      } finally {
        // Never skipped: a rejecting close would otherwise leave the worker,
        // and its transcriber, running for the life of the page.
        worker.terminate();
      }
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
      resolve({
        stop: async () => {
          stopped = true;
          recognition.stop();
        },
      });
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
 */
export async function startDictation(
  callbacks: DictationCallbacks,
  preferLocalModel: boolean,
): Promise<DictationSession> {
  const engine = getDictationEngine(preferLocalModel);
  if (engine === "wasm") {
    try {
      return await startWasmDictation(callbacks);
    } catch (error) {
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
    // would start a ~51 MB model download right after the user turned that
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
