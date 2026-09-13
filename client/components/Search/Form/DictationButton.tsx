import { Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconMicrophone } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { settingsPubSub } from "@/modules/pubSub";
import {
  DictationError,
  type DictationSession,
  getDictationEngine,
  startDictation,
} from "@/modules/speechToText";

interface DictationButtonProps {
  /** Reads the current search field content, so dictation appends to it. */
  getText: () => string;
  /** Replaces the search field content with the text plus the transcript. */
  setText: (text: string) => void;
}

type DictationPhase = "idle" | "loading" | "recording";

/**
 * Splices the transcript into the search field without clobbering edits the
 * user makes while speaking: the previously inserted transcript is stripped
 * from the current value before the new one is appended.
 */
function spliceTranscript(
  current: string,
  previousTranscript: string,
  transcript: string,
): string {
  const base =
    previousTranscript.length > 0 && current.endsWith(previousTranscript)
      ? current.slice(0, current.length - previousTranscript.length)
      : current;
  const separator =
    base.length > 0 && !/\s$/.test(base) && transcript.length > 0 ? " " : "";
  return `${base}${separator}${transcript}`;
}

/**
 * `total` never arrives on this path: the library's asset downloader opens its
 * progress session with an undefined total and reports that, whatever
 * `Content-Length` the route sets. Megabytes still tell the user the ~51 MB
 * download is moving rather than stuck.
 */
function formatDownloadProgress(
  progress: { loaded: number; total?: number } | null,
): string {
  if (!progress) return "";
  if (progress.total) {
    const percent = Math.min(
      100,
      Math.round((progress.loaded / progress.total) * 100),
    );
    return ` ${percent}%`;
  }
  const megabytes = Math.round(progress.loaded / 1_000_000);
  return megabytes > 0 ? ` ${megabytes} MB` : "";
}

export default memo(function DictationButton({
  getText,
  setText,
}: DictationButtonProps) {
  const [settings] = usePubSub(settingsPubSub);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [progress, setProgress] = useState<{
    loaded: number;
    total?: number;
  } | null>(null);
  const sessionRef = useRef<DictationSession | null>(null);
  const lastTranscriptRef = useRef("");

  const handleTranscript = useCallback(
    (transcript: string) => {
      setText(
        spliceTranscript(getText(), lastTranscriptRef.current, transcript),
      );
      lastTranscriptRef.current = transcript;
    },
    [getText, setText],
  );

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    lastTranscriptRef.current = "";
    setPhase("idle");
    setProgress(null);
    await session?.stop();
  }, []);

  /**
   * Bumped once per press, and again whenever a session loses its UI: the
   * button unmounted, or the setting was turned off. A load that resolves under
   * a stale generation is stopped and discarded, because there would be nothing
   * on screen to stop it. A counter rather than a flag, so a later press cannot
   * un-abandon a load an earlier one gave up on.
   */
  const pressGenerationRef = useRef(0);

  useEffect(
    () => () => {
      // `SearchForm` is remounted the moment the query goes non-empty, so
      // dictating on the home page and pressing Search unmounts this button
      // mid-session. Without this the microphone track, the AudioContext and
      // the worker all outlive it, with the recording indicator still on.
      pressGenerationRef.current += 1;
      void sessionRef.current?.stop();
      sessionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    // Returning null below is not an unmount, so the cleanup never runs and
    // the session would keep writing into a field with no button to stop it.
    // Not guarded on `sessionRef`: during the load that is still null, and the
    // session arrives after the button is already gone.
    if (settings.enableDictation) return;
    pressGenerationRef.current += 1;
    void stop();
  }, [settings.enableDictation, stop]);

  const handleClick = useCallback(async () => {
    if (sessionRef.current) {
      await stop();
      return;
    }
    if (phase === "loading") return;

    const generation = ++pressGenerationRef.current;
    setPhase("loading");
    try {
      const session = await startDictation({
        onTranscript: handleTranscript,
        onProgress: (loaded, total) => setProgress({ loaded, total }),
        onFallback: () =>
          notifications.show({
            title: "Using the browser's recognizer",
            message:
              "The on-device model could not run, so this browser's own speech recognition is transcribing instead. It may send the audio to the browser vendor.",
            color: "yellow",
          }),
        onEnd: () => void stop(),
        onError: (error) => {
          const denied = error.kind === "permission";
          notifications.show({
            title: denied
              ? "Microphone permission denied"
              : "Dictation stopped",
            message: denied
              ? "Allow microphone access in the browser settings to dictate a search."
              : error.message,
            color: "red",
          });
          void stop();
        },
      });
      // The load takes seconds and the permission prompt can take minutes, so
      // the button may well be gone by now; whichever path removed it had no
      // session to stop when it ran.
      if (pressGenerationRef.current !== generation) {
        void session.stop();
        return;
      }
      sessionRef.current = session;
      setPhase("recording");
    } catch (error) {
      setPhase("idle");
      setProgress(null);
      const denied =
        error instanceof DictationError && error.kind === "permission";
      notifications.show({
        title: denied
          ? "Microphone permission denied"
          : "Dictation is unavailable",
        message: denied
          ? "Allow microphone access in the browser settings to dictate a search."
          : error instanceof Error
            ? error.message
            : "Dictation could not be started.",
        color: "red",
      });
    }
  }, [handleTranscript, stop, phase]);

  if (!settings.enableDictation || getDictationEngine() === null) return null;

  const recording = phase === "recording";
  const percent = formatDownloadProgress(progress);

  return (
    <Button
      size="xs"
      variant={recording ? "light" : "default"}
      color={recording ? "red" : "gray"}
      onClick={handleClick}
      aria-label={
        recording
          ? "Stop dictating the search query"
          : "Dictate the search query"
      }
      aria-pressed={recording}
      data-dictation-phase={phase}
      leftSection={
        <IconMicrophone
          size={14}
          style={
            recording ? { color: "var(--mantine-color-red-filled)" } : undefined
          }
        />
      }
    >
      {phase === "loading"
        ? `Loading${percent}`
        : recording
          ? "Listening"
          : "Dictate"}
    </Button>
  );
});
