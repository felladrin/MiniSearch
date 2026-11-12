import { ActionIcon, Loader, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconMicrophone, IconPlayerStopFilled } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { settingsPubSub } from "@/modules/pubSub";
import { defaultSettings } from "@/modules/settings";
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

/**
 * Mantine's input border. The button is inset by it so its hover and
 * recording fills stay inside the field instead of painting over its border.
 */
const fieldBorderWidth = 1;

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
  /** Distance from the field's right edge to the positioned ancestor's, in pixels. */
  rightOffset?: number;
  /** Blocks a new session and stops one already running. */
  disabled?: boolean;
}

type DictationPhase = "idle" | "loading" | "recording" | "transcribing";

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
 * A percentage when the download's size is known. Without a `Content-Length`
 * the total is missing, and megabytes still tell the user the ~700 MB
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

  /**
   * Ends the session and waits for its transcript: the on-device model only
   * transcribes once the recording is over. The session stays in the ref
   * until then, so a field that goes away meanwhile can still cancel it.
   */
  const finish = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    setPhase("transcribing");
    setProgress(null);
    await session.stop();
    // Cancelled while transcribing; `cancel` already reset everything.
    if (sessionRef.current !== session) return;
    sessionRef.current = null;
    lastTranscriptRef.current = "";
    setPhase("idle");
  }, []);

  /**
   * Bumped once per press, and again whenever a session loses its UI: the
   * button unmounted, or the setting was turned off. A load that resolves under
   * a stale generation is stopped and discarded, because there would be nothing
   * on screen to stop it. A counter rather than a flag, so a later press cannot
   * un-abandon a load an earlier one gave up on.
   */
  const pressGenerationRef = useRef(0);

  /**
   * Aborts the press still loading, so a ~700 MB first-run download stops
   * with the button that started it instead of finishing in the background.
   */
  const loadAbortRef = useRef<AbortController | null>(null);

  /** Ends the session and drops its transcript, for a field that cannot take it. */
  const cancel = useCallback(() => {
    pressGenerationRef.current += 1;
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    lastTranscriptRef.current = "";
    setPhase("idle");
    setProgress(null);
    session?.cancel();
  }, []);

  useEffect(
    () => () => {
      // `SearchForm` is remounted the moment the query goes non-empty, so
      // dictating on the home page and pressing Search unmounts this button
      // mid-session. Without this the microphone track, the AudioContext and
      // the model all outlive it, with the recording indicator still on.
      pressGenerationRef.current += 1;
      loadAbortRef.current?.abort();
      sessionRef.current?.cancel();
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
    cancel();
  }, [settings.enableDictation, cancel]);

  useEffect(() => {
    // Same reasoning as the setting above, for a field that goes read-only
    // under a running session: disabling the button only blocks the next
    // press, so without this the transcript keeps landing in a field the
    // user can no longer correct, and the caller clears on its own schedule.
    if (!disabled) return;
    cancel();
  }, [disabled, cancel]);

  /**
   * An upgrading profile's stored settings lack this key until `App` merges
   * the defaults after `/api/config` resolves. Reading it raw would be
   * falsy in that window and hand the microphone to the vendor recognizer
   * unnoticed, so the derived default is applied here as well.
   */
  const preferLocalModel =
    settings.enableLocalDictationModel ??
    defaultSettings.enableLocalDictationModel;

  const handleClick = useCallback(async () => {
    if (phase === "loading" || phase === "transcribing") return;
    if (sessionRef.current) {
      await finish();
      return;
    }

    const generation = ++pressGenerationRef.current;
    const loadAbort = new AbortController();
    loadAbortRef.current = loadAbort;
    setPhase("loading");
    try {
      const session = await startDictation(
        {
          onTranscript: handleTranscript,
          onProgress: (loaded, total) => {
            if (pressGenerationRef.current === generation)
              setProgress({ loaded, total });
          },
          onFallback: () =>
            notifications.show({
              title: "Using the browser's recognizer",
              message:
                "The on-device model could not run, so this browser's own speech recognition is transcribing instead. It may send the audio to the browser vendor.",
              color: "yellow",
            }),
          onEnd: () => void finish(),
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
            cancel();
          },
        },
        preferLocalModel,
        loadAbort.signal,
      );
      if (loadAbortRef.current === loadAbort) loadAbortRef.current = null;
      // The load takes seconds and the permission prompt can take minutes, so
      // the button may well be gone by now; whichever path removed it had no
      // session to stop when it ran.
      if (pressGenerationRef.current !== generation) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      setPhase("recording");
    } catch (error) {
      if (loadAbortRef.current === loadAbort) loadAbortRef.current = null;
      // An abandoned press has no button left to explain a failure on, and a
      // newer press owns the phase now.
      if (pressGenerationRef.current !== generation) return;
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
  }, [handleTranscript, finish, cancel, phase, preferLocalModel]);

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
      : phase === "transcribing"
        ? `Transcribing ${labelScope}`
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
          right: rightOffset + fieldBorderWidth,
          top: fieldBorderWidth,
          bottom: fieldBorderWidth,
          height: `calc(100% - ${2 * fieldBorderWidth}px)`,
          width: dictationButtonWidth,
          // Mantine paints a disabled ActionIcon with a solid fill whatever
          // its variant, which shows as an opaque block over the faded field.
          ...(disabled && { backgroundColor: "transparent" }),
        }}
      >
        {phase === "loading" || phase === "transcribing" ? (
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
