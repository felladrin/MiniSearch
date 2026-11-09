import {
  DICTATION_MODEL_SOURCE,
  DictationError,
  encodeWav,
  getDictationEngine,
  MAX_RECORDING_SECONDS,
  resampleTo16k,
  startDictation,
  stripLanguageTag,
} from "@/modules/speechToText";
import { createWllamaInstance } from "@/modules/wllama";

vi.mock("@/modules/wllama", () => ({ createWllamaInstance: vi.fn() }));
vi.mock("@/modules/webGpu", () => ({ webGpuSupport: Promise.resolve(false) }));

/** The parts of a wllama instance the dictation calls. */
class FakeWllama {
  loadModelFromUrl = vi.fn(
    async (
      _source: unknown,
      params: {
        progressCallback?: (progress: {
          loaded: number;
          total: number;
        }) => void;
        signal?: AbortSignal;
      },
    ) => {
      params.progressCallback?.({ loaded: 1000, total: 2000 });
    },
  );
  createTranscription = vi.fn(
    async (_params: { file: ArrayBuffer; abortSignal?: AbortSignal }) => ({
      text: "language English<asr_text>hello world",
    }),
  );
  exit = vi.fn(async () => {});
}

let wllama: FakeWllama;

class FakeMediaStreamTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

function makeMediaStream() {
  const tracks = [new FakeMediaStreamTrack(), new FakeMediaStreamTrack()];
  return {
    tracks,
    stream: {
      getTracks: () => tracks,
    } as unknown as MediaStream,
  };
}

type AudioProcessHandler = (event: {
  inputBuffer: { getChannelData: (channel: number) => Float32Array };
  outputBuffer: { getChannelData: (channel: number) => Float32Array };
}) => void;

/** The script processor of the latest audio context, to feed it samples. */
let processor:
  | {
      onaudioprocess: AudioProcessHandler | null;
      disconnect: ReturnType<typeof vi.fn>;
    }
  | undefined;
let closeAudioContext: ReturnType<typeof vi.fn<() => Promise<void>>>;

/** Hands the processor one block captured at the stubbed rate. */
function capture(samples: number, input = new Float32Array(samples).fill(0.5)) {
  processor?.onaudioprocess?.({
    inputBuffer: { getChannelData: () => input },
    outputBuffer: { getChannelData: () => new Float32Array(samples) },
  });
}

function stubWasmSupport(
  getUserMedia: ReturnType<typeof vi.fn>,
  sampleRate = 48000,
) {
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("WebAssembly", { instantiate: vi.fn() });
  closeAudioContext = vi.fn<() => Promise<void>>(() => Promise.resolve());
  vi.stubGlobal(
    "AudioContext",
    class {
      sampleRate = sampleRate;
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createScriptProcessor() {
        processor = {
          onaudioprocess: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
        } as unknown as typeof processor;
        return processor;
      }
      close() {
        return closeAudioContext();
      }
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

/** The number of samples in the WAV file handed to the transcription. */
function transcribedSamples() {
  const { file } = wllama.createTranscription.mock.calls[0][0];
  return new DataView(file).getUint32(40, true) / 2;
}

const originalMediaDevices = navigator.mediaDevices;

beforeEach(() => {
  wllama = new FakeWllama();
  vi.mocked(createWllamaInstance).mockReset();
  vi.mocked(createWllamaInstance).mockResolvedValue(
    wllama as unknown as Awaited<ReturnType<typeof createWllamaInstance>>,
  );
  processor = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: originalMediaDevices,
  });
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

describe("getDictationEngine", () => {
  function installRecognitionFake() {
    class FakeRecognition {
      start = vi.fn();
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition =
      FakeRecognition;
  }

  it("reports the wasm engine when it is preferred and every piece is present", () => {
    stubWasmSupport(vi.fn());
    expect(getDictationEngine(true)).toBe("wasm");
  });

  it("falls back to web-speech when the wasm pieces are missing", () => {
    installRecognitionFake();
    expect(getDictationEngine(true)).toBe("web-speech");
  });

  it("prefers web-speech over a capable wasm path when the local model is off", () => {
    stubWasmSupport(vi.fn());
    installRecognitionFake();
    expect(getDictationEngine(false)).toBe("web-speech");
  });

  it("keeps the wasm engine when the local model is off but no recognizer exists", () => {
    // The preference reorders engines, it never empties the list: a browser
    // without `SpeechRecognition` (Firefox, for one) must still get a
    // working Dictate button with the setting off.
    stubWasmSupport(vi.fn());
    expect(getDictationEngine(false)).toBe("wasm");
  });

  it("reports no engine when neither path is available", () => {
    expect(getDictationEngine(true)).toBeNull();
    expect(getDictationEngine(false)).toBeNull();
  });
});

describe("resampleTo16k", () => {
  it("passes 16 kHz audio through untouched", () => {
    const input = new Float32Array([0.5, -0.5]);
    expect(resampleTo16k(input, 16000)).toBe(input);
  });

  it("resamples 48 kHz audio to a third of the length with interpolated values", () => {
    const input = new Float32Array([0, 1, 2, 3, 4, 5]);
    const output = resampleTo16k(input, 48000);
    expect(output.length).toBe(2);
    expect(output[0]).toBeCloseTo(0);
    expect(output[1]).toBeCloseTo(3);
  });
});

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM header and clamps the samples", () => {
    const file = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
    const view = new DataView(file);
    const text = (offset: number) =>
      String.fromCharCode(
        ...new Uint8Array(file.slice(offset, offset + 4)).values(),
      );

    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(4, true)).toBe(44);
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint32(40, true)).toBe(8);
    expect(file.byteLength).toBe(52);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32767, 32767,
    ]);
  });
});

describe("stripLanguageTag", () => {
  it("keeps only the text after the detected language", () => {
    expect(
      stripLanguageTag("language Portuguese<asr_text>A torre foi construída."),
    ).toBe("A torre foi construída.");
  });

  it("leaves an answer without the tag as it is", () => {
    expect(stripLanguageTag("  plain text ")).toBe("plain text");
  });

  it("returns nothing for silence", () => {
    expect(stripLanguageTag("language None<asr_text>")).toBe("");
  });
});

describe("startDictation with the wasm engine", () => {
  /** Minimal `SpeechRecognition` stand-in; reports whether it was started. */
  function installLocalRecognitionFake() {
    let started = false;
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: unknown = null;
      onerror: unknown = null;
      onend: unknown = null;
      start() {
        started = true;
      }
      stop() {}
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition =
      FakeRecognition;
    return () => started;
  }

  it("loads the pinned model, transcribes the recording on stop and releases everything", async () => {
    const { tracks, stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    const onTranscript = vi.fn();
    const progress: [number, number | undefined][] = [];

    const session = await startDictation(
      {
        onTranscript,
        onProgress: (loaded, total) => progress.push([loaded, total]),
      },
      true,
    );

    expect(wllama.loadModelFromUrl).toHaveBeenCalledWith(
      DICTATION_MODEL_SOURCE,
      expect.objectContaining({ n_gpu_layers: 0 }),
    );
    expect(progress).toEqual([[1000, 2000]]);

    capture(4800);
    capture(4800);
    // Nothing is transcribed while the microphone is open.
    expect(wllama.createTranscription).not.toHaveBeenCalled();

    await session.stop();

    // Two 48 kHz blocks of 4800 samples are 0.2 s, or 3200 samples at 16 kHz.
    expect(transcribedSamples()).toBe(3200);
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("hello world");
    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(processor?.disconnect).toHaveBeenCalled();
    expect(closeAudioContext).toHaveBeenCalledTimes(1);
    expect(wllama.exit).toHaveBeenCalledTimes(1);
  });

  it("copies each block on a 16 kHz device, whose capture buffer is reused", async () => {
    const { stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream), 16000);

    const session = await startDictation({ onTranscript: vi.fn() }, true);
    // The browser hands the processor the same array for every block.
    const reused = new Float32Array(2).fill(0.5);
    capture(2, reused);
    reused.fill(-0.5);
    capture(2, reused);
    await session.stop();

    const { file } = wllama.createTranscription.mock.calls[0][0];
    const view = new DataView(file);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      16384, 16384, -16383, -16383,
    ]);
  });

  it("stops the download and never opens the microphone when abandoned mid-load", async () => {
    const getUserMedia = vi.fn();
    stubWasmSupport(getUserMedia);
    const started = installLocalRecognitionFake();
    wllama.loadModelFromUrl.mockImplementation(
      (_source, params: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          params.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const abort = new AbortController();
    const onFallback = vi.fn();

    const loading = startDictation(
      { onTranscript: vi.fn(), onFallback },
      true,
      abort.signal,
    );
    await vi.waitFor(() =>
      expect(wllama.loadModelFromUrl).toHaveBeenCalledTimes(1),
    );
    abort.abort();

    await expect(loading).rejects.toBeInstanceOf(DictationError);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(wllama.exit).toHaveBeenCalledTimes(1);
    // The button is gone, so the vendor's recognizer must not take over.
    expect(onFallback).not.toHaveBeenCalled();
    expect(started()).toBe(false);
  });

  it("drops a model that finished loading after the session was abandoned", async () => {
    const getUserMedia = vi.fn();
    stubWasmSupport(getUserMedia);
    const abort = new AbortController();
    wllama.loadModelFromUrl.mockImplementation(async () => {
      abort.abort();
    });

    await expect(
      startDictation({ onTranscript: vi.fn() }, true, abort.signal),
    ).rejects.toBeInstanceOf(DictationError);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(wllama.exit).toHaveBeenCalledTimes(1);
  });

  it("reports a permission error and unloads the model when the microphone is denied", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(
        new DOMException("Permission denied", "NotAllowedError"),
      );
    stubWasmSupport(getUserMedia);
    const started = installLocalRecognitionFake();

    await expect(
      startDictation({ onTranscript: vi.fn() }, true),
    ).rejects.toMatchObject({ kind: "permission" });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(wllama.exit).toHaveBeenCalledTimes(1);
    // Falling back here would ask again and, in Chrome, send the audio away.
    expect(started()).toBe(false);
  });

  it("falls back to the browser recognizer without opening the microphone when the model fails to load", async () => {
    const getUserMedia = vi.fn();
    stubWasmSupport(getUserMedia);
    wllama.loadModelFromUrl.mockRejectedValue(new Error("network error"));
    const started = installLocalRecognitionFake();
    const onFallback = vi.fn();

    await startDictation({ onTranscript: vi.fn(), onFallback }, true);

    expect(started()).toBe(true);
    expect(onFallback).toHaveBeenCalledTimes(1);
    // The load runs first, so a failed download never lights the recording
    // indicator at all.
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(wllama.exit).toHaveBeenCalledTimes(1);
  });

  it("rejects with an engine error when the model fails to load and no recognizer exists", async () => {
    stubWasmSupport(vi.fn());
    wllama.loadModelFromUrl.mockRejectedValue(new Error("network error"));

    const failure = startDictation({ onTranscript: vi.fn() }, true);

    await expect(failure).rejects.toBeInstanceOf(DictationError);
    await expect(failure).rejects.toMatchObject({ kind: "engine" });
  });

  it("reports a transcription that fails after stop", async () => {
    const { stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    wllama.createTranscription.mockRejectedValue(new Error("out of memory"));
    const onTranscript = vi.fn();
    const onError = vi.fn();

    const session = await startDictation({ onTranscript, onError }, true);
    capture(4800);
    await session.stop();

    expect(onTranscript).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ kind: "engine" });
    expect(wllama.exit).toHaveBeenCalledTimes(1);
  });

  it("drops the transcript of a session cancelled while it transcribes", async () => {
    const { stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    // Like wllama, unloading rejects the request still running.
    let unload: (() => void) | undefined;
    wllama.createTranscription.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          unload = () => reject(new Error("The model was unloaded"));
        }),
    );
    wllama.exit.mockImplementation(async () => unload?.());
    const onTranscript = vi.fn();
    const onError = vi.fn();

    const session = await startDictation({ onTranscript, onError }, true);
    capture(4800);
    const stopping = session.stop();
    await vi.waitFor(() =>
      expect(wllama.createTranscription).toHaveBeenCalledTimes(1),
    );

    session.cancel();

    expect(
      wllama.createTranscription.mock.calls[0][0].abortSignal?.aborted,
    ).toBe(true);
    // Unloaded at once, so the transcription stops using the CPU now.
    expect(wllama.exit).toHaveBeenCalled();

    await stopping;

    expect(onTranscript).not.toHaveBeenCalled();
    // The unload's rejection is the cancel, not a failure to report.
    expect(onError).not.toHaveBeenCalled();
  });

  it("releases the microphone and the model when cancelled while recording", async () => {
    const { tracks, stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    const onTranscript = vi.fn();

    const session = await startDictation({ onTranscript }, true);
    capture(4800);
    session.cancel();
    await session.stop();

    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(wllama.exit).toHaveBeenCalledTimes(1);
    expect(wllama.createTranscription).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("ends the recording at the cap and transcribes exactly that much", async () => {
    const { tracks, stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    const onEnd = vi.fn();

    const session = await startDictation(
      { onTranscript: vi.fn(), onEnd },
      true,
    );
    // Blocks of 16384 samples at 16 kHz, so one straddles the cap, and more
    // of them than the cap holds.
    for (let block = 0; block < MAX_RECORDING_SECONDS; block++) capture(49152);

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(tracks.every((track) => track.stopped)).toBe(true);

    await session.stop();
    // Past the cap the audio would no longer fit the model's context.
    expect(transcribedSamples()).toBe(MAX_RECORDING_SECONDS * 16000);
  });

  it("gives a second stop the same transcript instead of resolving early", async () => {
    const { stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    const onTranscript = vi.fn();

    const session = await startDictation({ onTranscript }, true);
    capture(4800);
    const first = session.stop();
    const second = session.stop();

    expect(second).toBe(first);
    await second;
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(wllama.createTranscription).toHaveBeenCalledTimes(1);
  });

  it("skips the transcription when nothing was recorded", async () => {
    const { stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    const onTranscript = vi.fn();

    const session = await startDictation({ onTranscript }, true);
    await session.stop();

    expect(wllama.createTranscription).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(wllama.exit).toHaveBeenCalledTimes(1);
  });
});

describe("startDictation with the local model preference off", () => {
  let recognitionStarted = false;

  function installRecognitionFake(
    startImpl: () => void = () => {
      recognitionStarted = true;
    },
  ) {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: unknown = null;
      onerror: unknown = null;
      onend: unknown = null;
      start = startImpl;
      stop = () => {};
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition =
      FakeRecognition;
  }

  beforeEach(() => {
    recognitionStarted = false;
  });

  it("never loads the model on a fully wasm-capable browser", async () => {
    // The whole point of the setting: with it off, the ~700 MB model must
    // not be downloaded even where it could run.
    const { stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    installRecognitionFake();

    const session = await startDictation({ onTranscript: vi.fn() }, false);

    expect(createWllamaInstance).not.toHaveBeenCalled();
    expect(recognitionStarted).toBe(true);
    await session.stop();
  });

  it("does not fall back to the wasm engine when the recognizer fails", async () => {
    // A reverse fallback would start the ~700 MB download right after the
    // user turned that model off; the failure must surface instead.
    stubWasmSupport(vi.fn());
    installRecognitionFake(() => {
      throw new Error("recognizer refused to start");
    });

    await expect(
      startDictation({ onTranscript: vi.fn() }, false),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(createWllamaInstance).not.toHaveBeenCalled();
  });
});

describe("startDictation with the web speech fallback", () => {
  interface RecognitionFake {
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
    stopped: boolean;
  }

  let instance: RecognitionFake | undefined;

  function installRecognitionFake(startImpl: () => void = () => {}) {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: RecognitionFake["onresult"] = null;
      onerror: RecognitionFake["onerror"] = null;
      onend: (() => void) | null = null;
      stopped = false;
      start: () => void;
      stop = () => {
        this.stopped = true;
      };
      constructor() {
        this.start = startImpl;
        instance = this as unknown as RecognitionFake;
      }
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition =
      FakeRecognition;
  }

  it("transcribes interim results and stops on request", async () => {
    installRecognitionFake();

    const transcripts: string[] = [];
    const session = await startDictation(
      {
        onTranscript: (text) => transcripts.push(text),
      },
      true,
    );

    expect(instance?.continuous).toBe(true);
    expect(instance?.interimResults).toBe(true);

    instance?.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: false, 0: { transcript: "search for" } }],
    });
    instance?.onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: true, 0: { transcript: "search for" } },
        { isFinal: false, 0: { transcript: " moonshine" } },
      ],
    });

    expect(transcripts).toEqual(["search for", "search for moonshine"]);

    await session.stop();
    expect(instance?.stopped).toBe(true);
  });

  it("reports a permission error raised before the session resolves", async () => {
    installRecognitionFake(() => {
      instance?.onerror?.({ error: "not-allowed" });
    });

    await expect(
      startDictation({ onTranscript: vi.fn() }, true),
    ).rejects.toMatchObject({ kind: "permission" });
  });

  it("reports a denial that arrives after the session resolved", async () => {
    // What a real browser does: `start()` returns, and the denial arrives on a
    // later task. Rejecting the already-resolved promise would be a no-op, so
    // without the `onError` route the user is told nothing at all.
    installRecognitionFake();
    const onError = vi.fn();

    const session = await startDictation(
      {
        onTranscript: vi.fn(),
        onError,
      },
      true,
    );

    instance?.onerror?.({ error: "not-allowed" });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ kind: "permission" });
    await session.stop();
  });

  it("ends the session quietly when the recognizer stops on its own", async () => {
    installRecognitionFake();
    const onError = vi.fn();
    const onEnd = vi.fn();

    const session = await startDictation(
      {
        onTranscript: vi.fn(),
        onEnd,
        onError,
      },
      true,
    );

    // Chrome ends after silence even with `continuous`. The session is over,
    // but there is nothing the user needs told about.
    instance?.onend?.();

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    await session.stop();
  });

  it("says nothing when the recognizer ends because it was stopped", async () => {
    installRecognitionFake();
    const onError = vi.fn();
    const onEnd = vi.fn();

    const session = await startDictation(
      {
        onTranscript: vi.fn(),
        onEnd,
        onError,
      },
      true,
    );

    await session.stop();
    instance?.onend?.();

    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe("startDictation without any engine", () => {
  it("rejects with an unavailable error", async () => {
    await expect(
      startDictation({ onTranscript: vi.fn() }, true),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
});
