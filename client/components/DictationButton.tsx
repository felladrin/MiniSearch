import { ActionIcon, Loader, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconMicrophone, IconPlayerStopFilled } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { settingsPubSub } from "@/modules/pubSub";
import { prefersLocalDictationModel } from "@/modules/settings";
import {
  DictationError,
  type DictationSession,
  getDictationEngine,
  startDictation,
} from "@/modules/speechToText";

/**
 * The button floats over the right end of the field it fills, so the field
 * has to reserve this much room for it. Exported rather than repeated, so a
 * size change here cannot leave a caller's text running underneath it.
 */
export const dictationButtonWidth = 34;

interface DictationButtonProps {
  /** Reads the current field content, so dictation appends to it. */
  getValue: () => string;
  /** Replaces the field content with the text plus the transcript. */
  setValue: (value: string) => void;
  /**
   * Names the field in the accessible labels, as the object of "Dictate" and
   * "Stop dictating": "the search query", "a follow-up question".
   */
  labelScope: string;
  /** Distance from the right edge of the positioned ancestor, in pixels. */
  rightOffset?: number;
  /** Blocks a new session and stops one already running. */
  disabled?: boolean;
}

type DictationPhase = "idle" | "loading" | "recording";

/**
 * Splices the transcript into the field without clobbering edits the
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
  getValue,
  setValue,
  labelScope,
  rightOffset = 0,
  disabled = false,
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
      setValue(
        spliceTranscript(getValue(), lastTranscriptRef.current, transcript),
      );
      lastTranscriptRef.current = transcript;
    },
    [getValue, setValue],
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

  useEffect(() => {
    // Same reasoning as the setting above, for a field that goes read-only
    // under a running session: disabling the button only blocks the next
    // press, so without this the transcript keeps landing in a field the
    // user can no longer correct, and the caller clears on its own schedule.
    if (!disabled) return;
    pressGenerationRef.current += 1;
    void stop();
  }, [disabled, stop]);

  /**
   * An upgrading profile's stored settings lack this key until `App` merges
   * the defaults after `/api/config` resolves. Reading it raw would be
   * falsy in that window and hand the microphone to the vendor recognizer
   * unnoticed, so the derived default is applied here as well.
   */
  const preferLocalModel =
    settings.enableLocalDictationModel ?? prefersLocalDictationModel();

  const handleClick = useCallback(async () => {
    if (sessionRef.current) {
      await stop();
      return;
    }
    if (phase === "loading") return;

    const generation = ++pressGenerationRef.current;
    setPhase("loading");
    try {
      const session = await startDictation(
        {
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
        },
        preferLocalModel,
      );
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
  }, [handleTranscript, stop, phase, preferLocalModel]);

  if (
    !settings.enableDictation ||
    getDictationEngine(preferLocalModel) === null
  )
    return null;

  const recording = phase === "recording";
  const percent = formatDownloadProgress(progress);

  // One string for the tooltip and the accessible name, so the icon-only
  // button never says one thing on screen and another to a screen reader.
  // The download progress rides on it too: it is the only feedback the button
  // has left now that it has no text of its own.
  const label =
    phase === "loading"
      ? `Loading the dictation model${percent}`
      : recording
        ? `Stop dictating ${labelScope}`
        : `Dictate ${labelScope}`;

  return (
    <Tooltip label={label} withArrow position="top">
      <ActionIcon
        size="lg"
        variant={recording ? "light" : "subtle"}
        color={recording ? "red" : "gray"}
        onClick={handleClick}
        // The button sits inside the field, so a press must not take the
        // focus off it: the caret is where the user left it, and blurring
        // mid-dictation loses both the selection and the on-screen keyboard.
        onMouseDown={(event) => event.preventDefault()}
        disabled={disabled}
        aria-label={label}
        aria-pressed={recording}
        data-dictation-phase={phase}
        style={{
          position: "absolute",
          right: rightOffset,
          top: 0,
          bottom: 0,
          height: "100%",
          width: dictationButtonWidth,
        }}
      >
        {phase === "loading" ? (
          <Loader size={16} color="gray" />
        ) : recording ? (
          // A shape change, not only the red: an icon-only control whose
          // state is carried by color alone is unreadable to a colorblind
          // user, and this one has no text left to fall back on.
          <IconPlayerStopFilled size={16} />
        ) : (
          <IconMicrophone size={18} />
        )}
      </ActionIcon>
    </Tooltip>
  );
});
