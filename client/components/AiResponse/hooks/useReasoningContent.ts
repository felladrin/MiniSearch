import { usePubSub } from "create-pubsub/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { settingsPubSub } from "../../../modules/pubSub";

interface ReasoningContent {
  reasoningContent: string;
  mainContent: string;
  isGenerating: boolean;
  thinkingTimeMs: number;
}

export function useReasoningContent(content: string): ReasoningContent {
  const [settings] = usePubSub(settingsPubSub);
  const reasoningStartTime = useRef<number>(0);
  const totalThinkingTime = useRef<number>(0);

  const extractReasoningAndMainContent = useCallback(
    (text: string, startMarker: string, endMarker: string) => {
      if (!text) {
        return { reasoningContent: "", mainContent: "", isGenerating: false };
      }

      const startIndex = text.indexOf(startMarker);
      const isReasoningSectionMissing = startIndex === -1;

      if (isReasoningSectionMissing) {
        return { reasoningContent: "", mainContent: text, isGenerating: false };
      }

      const endIndex = text.indexOf(endMarker);
      const isReasoningInProgress = endIndex === -1;

      if (isReasoningInProgress) {
        initializeTimingIfNeeded();
        return {
          reasoningContent: text.slice(startIndex + startMarker.length),
          mainContent: "",
          isGenerating: true,
        };
      }

      const hasValidReasoningSection = startIndex < endIndex;
      if (hasValidReasoningSection) {
        finalizeThinkingTimeIfNeeded();
        return {
          reasoningContent: text.slice(
            startIndex + startMarker.length,
            endIndex,
          ),
          mainContent: text.slice(endIndex + endMarker.length),
          isGenerating: false,
        };
      }

      return { reasoningContent: "", mainContent: text, isGenerating: false };
    },
    [],
  );

  const initializeTimingIfNeeded = () => {
    if (!reasoningStartTime.current) {
      reasoningStartTime.current = Date.now();
    }
  };

  const finalizeThinkingTimeIfNeeded = () => {
    if (reasoningStartTime.current && !totalThinkingTime.current) {
      totalThinkingTime.current = Date.now() - reasoningStartTime.current;
    }
  };

  const { reasoningContent, mainContent, isGenerating } = useMemo(
    () =>
      extractReasoningAndMainContent(
        content,
        settings.reasoningStartMarker,
        settings.reasoningEndMarker,
      ),
    [
      content,
      settings.reasoningStartMarker,
      settings.reasoningEndMarker,
      extractReasoningAndMainContent,
    ],
  );

  useEffect(() => {
    const shouldResetTiming = !content;
    if (shouldResetTiming) {
      reasoningStartTime.current = 0;
      totalThinkingTime.current = 0;
    }
  }, [content]);

  return {
    reasoningContent,
    mainContent,
    isGenerating,
    thinkingTimeMs: totalThinkingTime.current,
  };
}
