import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerRequest } from "./textToSpeechWorkerProtocol";

/**
 * The module caches the voice catalogue for the session, so each test imports
 * it fresh instead of reaching into that cache.
 */
let tts: typeof import("./textToSpeech");

const mockVoices = vi.fn();

vi.mock("./piper", () => ({
  voices: () => mockVoices(),
  predict: vi.fn(),
}));

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));

const settings = {
  selectedVoiceId: "",
  textToSpeechEngine: "local" as "local" | "system",
  reasoningStartMarker: "<think>",
  reasoningEndMarker: "</think>",
};

vi.mock("./pubSub", () => ({
  getSettings: () => settings,
  updateTextToSpeechState: vi.fn(),
}));

const englishVoice = {
  key: "en_US-lessac-high",
  name: "lessac",
  quality: "high",
  language: { code: "en_US", name_english: "English" },
};

/** A worker stub the test drives by hand, standing in for the real one. */
function createFakeWorker() {
  const sent: WorkerRequest[] = [];
  const worker = {
    sent,
    terminate: vi.fn(),
    postMessage: (message: WorkerRequest) => sent.push(message),
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as (() => void) | null,
  };
  return worker;
}

let spoken: string[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  spoken = [];
  settings.selectedVoiceId = "";
  settings.textToSpeechEngine = "local";
  mockVoices.mockResolvedValue([englishVoice]);

  vi.stubGlobal("navigator", { language: "en-US" });
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "Audio",
    class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      src = "";
      play() {
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
    },
  );
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      voice: unknown = null;
      lang = "";
      constructor(public text: string) {}
    },
  );
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => [
      { voiceURI: "os-voice", name: "OS Voice", lang: "en-US" },
    ],
    cancel: vi.fn(),
    speak: (utterance: { text: string; onend: (() => void) | null }) => {
      spoken.push(utterance.text);
      queueMicrotask(() => utterance.onend?.());
    },
  });
  self.speechSynthesis = globalThis.speechSynthesis;

  tts = await import("./textToSpeech");
});

describe("prepareTextForSpeech", () => {
  it("drops reasoning blocks, link targets and markdown punctuation", () => {
    const text =
      "<think>hidden</think># Title\nSee [the docs](https://x.dev) `now`";
    expect(tts.prepareTextForSpeech(text, "<think>", "</think>")).toBe(
      "Title\nSee (the docs) now",
    );
  });
});

describe("splitIntoSentences", () => {
  it("splits on sentence endings and drops empty fragments", () => {
    expect(tts.splitIntoSentences("One. Two!  Three?\n\nFour")).toEqual([
      "One.",
      "Two!",
      "Three?",
      "Four",
    ]);
  });
});

describe("speak", () => {
  it("reads the answer with the local engine when it works", async () => {
    const worker = createFakeWorker();
    tts.setWorkerFactory(() => worker as unknown as Worker);

    const speaking = tts.speak("Hello there.");
    await vi.waitFor(() => expect(worker.sent).toHaveLength(1));

    expect(worker.sent[0]).toEqual({
      type: "speak",
      sentences: ["Hello there."],
      voiceId: "en_US-lessac-high",
    });

    worker.onmessage?.({
      data: {
        type: "audio",
        requestId: 1,
        index: 0,
        buffer: new ArrayBuffer(8),
      },
    });
    worker.onmessage?.({ data: { type: "done", requestId: 1 } });

    await speaking;
    expect(spoken).toEqual([]);
  });

  it("falls back to the system voice when the local engine cannot load", async () => {
    const worker = createFakeWorker();
    tts.setWorkerFactory(() => worker as unknown as Worker);

    const speaking = tts.speak("Hello there.");
    await vi.waitFor(() => expect(worker.sent).toHaveLength(1));

    worker.onmessage?.({
      data: { type: "error", requestId: 1, message: "model download failed" },
    });

    await speaking;
    expect(spoken).toEqual(["Hello there."]);
  });

  it("falls back when no local voice matches the language", async () => {
    mockVoices.mockResolvedValue([]);

    await tts.speak("Hello there.");

    expect(spoken).toEqual(["Hello there."]);
  });

  it("falls back when the voice catalogue cannot be reached", async () => {
    mockVoices.mockRejectedValue(new Error("offline"));

    await tts.speak("Hello there.");

    expect(spoken).toEqual(["Hello there."]);
  });

  it("uses the system engine directly when it is selected", async () => {
    settings.textToSpeechEngine = "system";
    const worker = createFakeWorker();
    tts.setWorkerFactory(() => worker as unknown as Worker);

    await tts.speak("Hello there.");

    expect(worker.sent).toEqual([]);
    expect(spoken).toEqual(["Hello there."]);
  });

  it("stops playback without falling back to the system voice", async () => {
    const worker = createFakeWorker();
    tts.setWorkerFactory(() => worker as unknown as Worker);

    const speaking = tts.speak("Hello there.");
    await vi.waitFor(() => expect(worker.sent).toHaveLength(1));

    tts.stopSpeaking();
    await speaking;

    expect(worker.sent).toContainEqual({ type: "stop" });
    expect(worker.terminate).toHaveBeenCalled();
    expect(spoken).toEqual([]);
  });
});

describe("listVoices", () => {
  it("offers the local voices for the language and the system voices", async () => {
    const options = await tts.listVoices("en-US");

    expect(options).toEqual([
      expect.objectContaining({
        value: "piper:en_US-lessac-high",
        engine: "local",
      }),
      expect.objectContaining({ value: "system:os-voice", engine: "system" }),
    ]);
  });

  it("still lists the system voices when the catalogue fails", async () => {
    mockVoices.mockRejectedValue(new Error("offline"));

    const options = await tts.listVoices("en-US");

    expect(options).toEqual([
      expect.objectContaining({ value: "system:os-voice", engine: "system" }),
    ]);
  });
});
