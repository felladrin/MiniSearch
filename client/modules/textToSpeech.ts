import { addLogEntry } from "./logEntries";
import type { Voice, VoiceId } from "./piper";
import { voices } from "./piper";
import { getSettings, updateTextToSpeechState } from "./pubSub";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./textToSpeechWorkerProtocol";

export type TextToSpeechEngine = "local" | "system";

/**
 * Voice ids are stored with an engine prefix so one `Select` can offer both
 * engines. A value without a prefix is a `speechSynthesis` voice URI stored by
 * an earlier version; it is honoured whenever the system engine runs, and
 * ignored by the local engine, which matches on language instead.
 */
const LOCAL_VOICE_PREFIX = "piper:";
const SYSTEM_VOICE_PREFIX = "system:";

export interface VoiceOption {
  value: string;
  label: string;
  engine: TextToSpeechEngine;
  languageCode: string;
}

/** The markers come from user settings, so a character like `(` must not be read as syntax. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips reasoning blocks, links and markdown punctuation so both engines are
 * fed the same plain text.
 */
export function prepareTextForSpeech(
  text: string,
  reasoningStartMarker: string,
  reasoningEndMarker: string,
): string {
  const withoutReasoning = text.replace(
    new RegExp(
      `${escapeForRegExp(reasoningStartMarker)}[\\s\\S]*?${escapeForRegExp(reasoningEndMarker)}`,
      "g",
    ),
    "",
  );
  const withoutLinks = withoutReasoning.replace(
    /\[([^\]]+)\]\([^)]+\)/g,
    "($1)",
  );
  return withoutLinks.replace(/[#*`_~[\]]/g, "").trim();
}

/**
 * Splits on sentence endings so the first sentence can start playing while the
 * rest are still being synthesized. Long sentences are left whole: Piper reads
 * them fine, and cutting mid-clause is audible.
 */
export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function primaryLanguage(code: string): string {
  return code.replace("_", "-").split("-")[0].toLowerCase();
}

let cachedLocalVoices: Promise<Voice[]> | null = null;

/**
 * The catalogue is fetched from the network, so it is read once per session.
 * It is deliberately not hardcoded: the published list already carries more
 * voices than the package's own `VoiceId` union, and a stale copy would offer
 * voices that fail to download.
 */
function getLocalVoices(): Promise<Voice[]> {
  if (!cachedLocalVoices) {
    cachedLocalVoices = voices().catch((error) => {
      cachedLocalVoices = null;
      throw error;
    });
  }
  return cachedLocalVoices;
}

/**
 * Local voices for the given language first, then every `speechSynthesis`
 * voice. Local voices are omitted when the catalogue cannot be reached, so the
 * form still lists the OS voices.
 */
export async function listVoices(
  languageCode: string = navigator.language,
): Promise<VoiceOption[]> {
  const options: VoiceOption[] = [];
  const wanted = primaryLanguage(languageCode);

  try {
    for (const voice of await getLocalVoices()) {
      if (primaryLanguage(voice.language.code) !== wanted) continue;
      options.push({
        value: `${LOCAL_VOICE_PREFIX}${voice.key}`,
        label: `${voice.name} • ${voice.language.name_english} (${voice.quality})`,
        engine: "local",
        languageCode: voice.language.code,
      });
    }
  } catch (error) {
    addLogEntry(
      `Could not load the local voice list: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  for (const voice of self.speechSynthesis?.getVoices() ?? []) {
    options.push({
      value: `${SYSTEM_VOICE_PREFIX}${voice.voiceURI}`,
      label: `${voice.name} • ${voice.lang}`,
      engine: "system",
      languageCode: voice.lang,
    });
  }

  return options;
}

/**
 * Resolves the stored setting to a voice the catalogue actually publishes, or
 * null when there is none. A stored voice that has since been removed falls
 * back to the language match instead of failing at download time.
 */
async function resolveLocalVoiceId(
  storedVoiceId: string,
  languageCode: string,
): Promise<VoiceId | null> {
  if (storedVoiceId.startsWith(SYSTEM_VOICE_PREFIX)) return null;

  const catalogue = await getLocalVoices();

  if (storedVoiceId.startsWith(LOCAL_VOICE_PREFIX)) {
    const wantedKey = storedVoiceId.slice(LOCAL_VOICE_PREFIX.length);
    const stored = catalogue.find((voice) => voice.key === wantedKey);
    if (stored) return stored.key;
  }

  const wanted = primaryLanguage(languageCode);
  const match = catalogue.find(
    (voice) => primaryLanguage(voice.language.code) === wanted,
  );
  return match?.key ?? null;
}

let workerFactory = () =>
  new Worker(new URL("./textToSpeechWorker.ts", import.meta.url), {
    type: "module",
  });

/** Lets the tests supply a fake worker; the real one needs a bundler. */
export function setWorkerFactory(factory: () => Worker) {
  workerFactory = factory;
}

/**
 * One playback. It is claimed synchronously by `speak()` before any await, so a
 * stop pressed while the voice catalogue is still loading is remembered instead
 * of being dropped; each engine then replaces `stop` with its own.
 */
interface SpeechSession {
  stop: () => void;
}

let activeSession: SpeechSession | null = null;

export function stopSpeaking(): void {
  activeSession?.stop();
}

function speakWithSystemVoice(
  text: string,
  storedVoiceId: string,
  session: SpeechSession,
): Promise<void> {
  return new Promise((resolve) => {
    if (!self.speechSynthesis) {
      addLogEntry("This browser provides no speech synthesis voices");
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const wantedUri = storedVoiceId.startsWith(SYSTEM_VOICE_PREFIX)
      ? storedVoiceId.slice(SYSTEM_VOICE_PREFIX.length)
      : storedVoiceId;

    if (wantedUri) {
      const voice = self.speechSynthesis
        .getVoices()
        .find((candidate) => candidate.voiceURI === wantedUri);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
    }

    utterance.onend = () => resolve();
    utterance.onerror = () => {
      addLogEntry("Failed to speak the response with a system voice");
      resolve();
    };

    session.stop = () => {
      self.speechSynthesis.cancel();
      resolve();
    };

    self.speechSynthesis.speak(utterance);
  });
}

/**
 * Plays the WAV buffers the worker sends back, in order, starting as soon as
 * the first one arrives. Resolves when the worker is done and the queue has
 * drained, or rejects when the worker could not synthesize at all.
 */
function speakWithLocalVoice(
  sentences: string[],
  voiceId: VoiceId,
  session: SpeechSession,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = workerFactory();
    const queue: ArrayBuffer[] = [];
    let element: HTMLAudioElement | null = null;
    let objectUrl: string | null = null;
    let synthesisDone = false;
    let playing = false;
    let stopped = false;
    /** Playback of a chunk actually began, so the user is hearing the answer. */
    let playbackSucceeded = false;

    const cleanUp = () => {
      worker.terminate();
      if (element) {
        // Detach first: the element can still fire `error` after teardown, for
        // instance when the object URL is revoked while it is still loading,
        // and a live handler would log that as a playback failure.
        element.onended = null;
        element.onerror = null;
        element.pause();
        element.removeAttribute("src");
        element = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      queue.length = 0;
    };

    const finish = () => {
      if (stopped) return;
      stopped = true;
      cleanUp();
      resolve();
    };

    const fail = (message: string) => {
      if (stopped) return;
      stopped = true;
      cleanUp();
      reject(new Error(message));
    };

    const releaseCurrentAudio = () => {
      playing = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };

    const playNext = () => {
      if (stopped || playing) return;
      const buffer = queue.shift();
      if (!buffer) {
        // Synthesis can report success while every chunk failed to play, for
        // instance when the browser no longer counts the click as a gesture
        // that allows audio. Reporting that as spoken would leave the user
        // with a silent answer and no fallback.
        if (!synthesisDone) return;
        if (playbackSucceeded) finish();
        else fail("The synthesized audio could not be played");
        return;
      }

      playing = true;
      objectUrl = URL.createObjectURL(
        new Blob([buffer], { type: "audio/wav" }),
      );
      const current = new Audio(objectUrl);
      element = current;

      /**
       * A failed resource fires `error` on the element and rejects the pending
       * `play()`, so without this guard one chunk would advance the queue
       * twice and cut off the chunk after it.
       */
      const advance = () => {
        if (element !== current) return;
        releaseCurrentAudio();
        playNext();
      };

      current.onended = () => {
        playbackSucceeded = true;
        advance();
      };
      current.onerror = () => {
        addLogEntry("A synthesized audio chunk could not be played");
        advance();
      };
      current.play().then(
        () => {
          // Resolves once playback has begun, which is the only reliable
          // signal that the user is actually hearing this chunk.
          playbackSucceeded = true;
        },
        (error) => {
          // `cleanUp()` pauses the element, which rejects a play() that has
          // not started yet. That is a stop, not a failure worth logging.
          if (stopped) return;
          addLogEntry(
            `Could not start audio playback: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
          advance();
        },
      );
    };

    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (stopped) return;
      if (data.type === "audio") {
        queue.push(data.buffer);
        playNext();
        return;
      }
      if (data.type === "done") {
        synthesisDone = true;
        playNext();
        return;
      }
      // Already audible: restarting on the system voice would repeat it.
      if (playbackSucceeded) {
        addLogEntry(`Local text-to-speech stopped early: ${data.message}`);
        finish();
      } else {
        fail(data.message);
      }
    };

    worker.onerror = () => {
      if (playbackSucceeded) finish();
      else fail("The local text-to-speech worker failed to start");
    };

    session.stop = () => finish();

    const request: WorkerRequest = { sentences, voiceId };
    worker.postMessage(request);
  });
}

/**
 * Reads the answer aloud, with the local neural voice when it is available and
 * the OS voices otherwise. Calling it while speaking stops the current playback.
 */
export async function speak(text: string): Promise<void> {
  if (activeSession) {
    stopSpeaking();
    return;
  }

  const settings = getSettings();
  const spokenText = prepareTextForSpeech(
    text,
    settings.reasoningStartMarker,
    settings.reasoningEndMarker,
  );
  if (!spokenText) return;

  let stopRequested = false;
  const session: SpeechSession = {
    stop: () => {
      stopRequested = true;
    },
  };
  activeSession = session;
  updateTextToSpeechState("speaking");

  try {
    const storedVoiceId = settings.selectedVoiceId ?? "";
    const wantsSystemVoice =
      settings.textToSpeechEngine === "system" ||
      storedVoiceId.startsWith(SYSTEM_VOICE_PREFIX);

    if (!wantsSystemVoice) {
      try {
        const voiceId = await resolveLocalVoiceId(
          storedVoiceId,
          navigator.language,
        );
        if (stopRequested) return;
        if (voiceId) {
          // Returning here is what keeps a stop silent: `speakWithLocalVoice`
          // resolves when the user stops, and falling through would then read
          // the whole answer again with a system voice.
          await speakWithLocalVoice(
            splitIntoSentences(spokenText),
            voiceId,
            session,
          );
          return;
        }
        addLogEntry(
          "No local voice matches this language; using the system voices",
        );
      } catch (error) {
        addLogEntry(
          `Local text-to-speech unavailable, using the system voices: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }

    if (stopRequested) return;
    await speakWithSystemVoice(spokenText, storedVoiceId, session);
  } finally {
    // A session that has already been replaced must not clear the live one.
    if (activeSession === session) {
      activeSession = null;
      updateTextToSpeechState("idle");
    }
  }
}
