import { usePubSub } from "create-pubsub/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { settingsPubSub } from "../../../modules/pubSub";

export function useReasoningContent(text: string) {
  const [settings] = usePubSub(settingsPubSub);
  const [thinkingTimeMs, setThinkingTimeMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  const initializeTimingIfNeeded = useCallback(() => {
    if (startTimeRef.current === null) {
      startTimeRef.current = Date.now();
    }
  }, []);

  const finalizeThinkingTimeIfNeeded = useCallback(() => {
    if (startTimeRef.current !== null) {
      setThinkingTimeMs(Date.now() - startTimeRef.current);
      startTimeRef.current = null;
    }
  }, []);

  const extractReasoningAndMainContent = useCallback(
    (text: string, startMarker: string, endMarker: string) => {
      if (!text)
        return { reasoningContent: "", mainContent: "", isGenerating: false };

      const startIndex = text.indexOf(startMarker);
      const endIndex = text.indexOf(endMarker);

      if (startIndex === -1)
        return { reasoningContent: "", mainContent: text, isGenerating: false };

      if (endIndex === -1) {
        initializeTimingIfNeeded();
        return {
          reasoningContent: text.slice(startIndex + startMarker.length),
          mainContent: "",
          isGenerating: true,
        };
      }

      finalizeThinkingTimeIfNeeded();
      return {
        reasoningContent: text.slice(startIndex + startMarker.length, endIndex),
        mainContent: text.slice(endIndex + endMarker.length),
        isGenerating: false,
      };
    },
    [initializeTimingIfNeeded, finalizeThinkingTimeIfNeeded],
  );

  const result = extractReasoningAndMainContent(
    text,
    settings.reasoningStartMarker,
    settings.reasoningEndMarker,
  );

  useEffect(() => {
    return () => {
      startTimeRef.current = null;
    };
  }, []);

  return {
    ...result,
    thinkingTimeMs,
  };
}
