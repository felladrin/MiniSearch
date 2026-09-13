import { Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconMicrophone } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { memo, useCallback, useRef, useState } from "react";
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

/** " 42%" when the total size is known, "" when it is not. */
function formatDownloadPercent(
  progress: { loaded: number; total?: number } | null,
): string {
  if (!progress?.total) return "";
  const percent = Math.min(
    100,
    Math.round((progress.loaded / progress.total) * 100),
  );
  return ` ${percent}%`;
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

  const handleClick = useCallback(async () => {
    if (sessionRef.current) {
      await stop();
      return;
    }
    if (phase === "loading") return;

    setPhase("loading");
    try {
      sessionRef.current = await startDictation({
        onTranscript: handleTranscript,
        onProgress: (loaded, total) => setProgress({ loaded, total }),
      });
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
  const percent = formatDownloadPercent(progress);

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
