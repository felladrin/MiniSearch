import {
  DictationError,
  type DictationSession,
  getDictationEngine,
  resampleTo16k,
  setWorkerFactory,
  startDictation,
} from "@/modules/speechToText";
import type { WorkerResponse } from "@/modules/speechToTextWorkerProtocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  messages: unknown[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown, _transfer?: Transferable[]) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(response: WorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent);
  }
}

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

function stubWasmSupport(getUserMedia: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("WebAssembly", { instantiate: vi.fn() });
  vi.stubGlobal(
    "AudioContext",
    class {
      sampleRate = 48000;
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createScriptProcessor() {
        return {
          onaudioprocess: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }
      close() {
        return Promise.resolve();
      }
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

const originalMediaDevices = navigator.mediaDevices;

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: originalMediaDevices,
  });
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  setWorkerFactory(() => {
    throw new Error("no worker factory configured");
  });
  FakeWorker.instances = [];
});

describe("getDictationEngine", () => {
  it("reports the wasm engine when every piece is present", () => {
    stubWasmSupport(vi.fn());
    expect(getDictationEngine()).toBe("wasm");
  });

  it("falls back to web-speech when the wasm pieces are missing", () => {
    class FakeRecognition {
      start = vi.fn();
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition =
      FakeRecognition;
    expect(getDictationEngine()).toBe("web-speech");
  });

  it("reports no engine when neither path is available", () => {
    expect(getDictationEngine()).toBeNull();
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

describe("startDictation with the wasm engine", () => {
  it("loads the model, streams the transcript and releases everything on stop", async () => {
    const { tracks, stream } = makeMediaStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubWasmSupport(getUserMedia);
    setWorkerFactory(() => new FakeWorker() as unknown as Worker);

    const transcripts: string[] = [];
    const progress: [number, number | undefined][] = [];

    const sessionPromise = startDictation({
      onTranscript: (text) => transcripts.push(text),
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });

    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(1));
    const worker = FakeWorker.instances[0];
    expect(worker.messages[0]).toMatchObject({ type: "load" });

    worker.respond({ type: "progress", loaded: 1000, total: 2000 });
    worker.respond({ type: "loaded" });

    const session: DictationSession = await sessionPromise;

    worker.respond({ type: "transcript", text: "hello" });
    worker.respond({ type: "transcript", text: "hello world" });

    expect(transcripts).toEqual(["hello", "hello world"]);
    expect(progress).toEqual([[1000, 2000]]);

    await session.stop();

    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(worker.terminated).toBe(true);
    expect(worker.messages).toContainEqual({ type: "stop" });
  });

  it("reports a permission error when the microphone is denied", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(
        new DOMException("Permission denied", "NotAllowedError"),
      );
    stubWasmSupport(getUserMedia);
    setWorkerFactory(() => new FakeWorker() as unknown as Worker);

    const sessionPromise = startDictation({ onTranscript: vi.fn() });
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(1));
    FakeWorker.instances[0].respond({ type: "loaded" });

    await expect(sessionPromise).rejects.toMatchObject({ kind: "permission" });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

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

  it("falls back to the browser recognizer when the local engine fails", async () => {
    const { stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    setWorkerFactory(() => new FakeWorker() as unknown as Worker);
    const started = installLocalRecognitionFake();

    const sessionPromise = startDictation({ onTranscript: vi.fn() });
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(1));
    // A 502 from `/dictation-models/` is "cannot run here", not "no engine".
    FakeWorker.instances[0].respond({
      type: "error",
      message: "model download failed",
    });

    await sessionPromise;
    expect(started()).toBe(true);
  });

  it("reports a denied microphone instead of falling back", async () => {
    stubWasmSupport(
      vi
        .fn()
        .mockRejectedValue(
          new DOMException("Permission denied", "NotAllowedError"),
        ),
    );
    setWorkerFactory(() => new FakeWorker() as unknown as Worker);
    const started = installLocalRecognitionFake();

    const sessionPromise = startDictation({ onTranscript: vi.fn() });
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(1));
    FakeWorker.instances[0].respond({ type: "loaded" });

    await expect(sessionPromise).rejects.toMatchObject({ kind: "permission" });
    // Falling back here would ask again and, in Chrome, send the audio away.
    expect(started()).toBe(false);
  });

  it("ignores a transcript that arrives after stop", async () => {
    const { stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    setWorkerFactory(() => new FakeWorker() as unknown as Worker);
    const onTranscript = vi.fn();

    const sessionPromise = startDictation({ onTranscript });
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(1));
    const worker = FakeWorker.instances[0];
    worker.respond({ type: "loaded" });
    const session = await sessionPromise;

    worker.respond({ type: "transcript", text: "hello world" });
    expect(onTranscript).toHaveBeenCalledWith("hello world");

    const stopping = session.stop();
    // Both engines emit one last result after being told to stop. The caller
    // has already forgotten what it appended, so this would be appended twice.
    worker.respond({ type: "transcript", text: "hello world" });
    worker.respond({ type: "stopped" });
    await stopping;

    expect(onTranscript).toHaveBeenCalledTimes(1);
  });

  it("waits for the worker to drain before terminating it", async () => {
    const { stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    setWorkerFactory(() => new FakeWorker() as unknown as Worker);

    const sessionPromise = startDictation({ onTranscript: vi.fn() });
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(1));
    const worker = FakeWorker.instances[0];
    worker.respond({ type: "loaded" });
    const session = await sessionPromise;

    const stopping = session.stop();
    await Promise.resolve();
    // The transcriber runs synchronously inside the worker's `onmessage`, so a
    // backlog can leave it seconds behind; terminating now drops the tail.
    expect(worker.terminated).toBe(false);

    worker.respond({ type: "stopped" });
    await stopping;
    expect(worker.terminated).toBe(true);
  });

  it("reports a worker failure that happens after the engine loaded", async () => {
    const { stream } = makeMediaStream();
    stubWasmSupport(vi.fn().mockResolvedValue(stream));
    setWorkerFactory(() => new FakeWorker() as unknown as Worker);
    const onError = vi.fn();

    const sessionPromise = startDictation({
      onTranscript: vi.fn(),
      onError,
    });
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(1));
    const worker = FakeWorker.instances[0];
    worker.respond({ type: "loaded" });
    await sessionPromise;

    // The load promise has settled, so rejecting it again is a no-op: without
    // a live channel the UI listens forever with the microphone open.
    worker.respond({ type: "error", message: "the transcriber died" });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ kind: "engine" });
  });

  it("never opens the microphone when the model fails to load", async () => {
    const { tracks, stream } = makeMediaStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubWasmSupport(getUserMedia);
    setWorkerFactory(() => new FakeWorker() as unknown as Worker);

    const sessionPromise = startDictation({ onTranscript: vi.fn() });
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(1));
    const worker = FakeWorker.instances[0];
    worker.respond({ type: "error", message: "model download failed" });

    await expect(sessionPromise).rejects.toBeInstanceOf(DictationError);
    await expect(
      sessionPromise.catch((error: DictationError) => error.kind),
    ).resolves.toBe("engine");
    // The load runs first, so a failed download never lights the recording
    // indicator at all.
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(tracks.every((track) => track.stopped)).toBe(false);
    expect(worker.terminated).toBe(true);
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
    const session = await startDictation({
      onTranscript: (text) => transcripts.push(text),
    });

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

  it("reports a permission error from the recognition error event", async () => {
    installRecognitionFake(() => {
      instance?.onerror?.({ error: "not-allowed" });
    });

    await expect(
      startDictation({ onTranscript: vi.fn() }),
    ).rejects.toMatchObject({ kind: "permission" });
  });
});

describe("startDictation without any engine", () => {
  it("rejects with an unavailable error", async () => {
    await expect(
      startDictation({ onTranscript: vi.fn() }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
});
