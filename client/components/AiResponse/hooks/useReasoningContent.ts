import { usePubSub } from "create-pubsub/react";
import { useCallback } from "react";
import { settingsPubSub } from "@/modules/pubSub";
import { splitReasoning } from "@/modules/reasoning";

/**
 * Splits a streamed AI response into the part between the reasoning markers
 * and the rest. `isGenerating` is reported only while the closing marker has
 * not arrived yet and `isResponseGenerating` says the response is still being
 * written; once generation stops (finished, interrupted, truncated), an
 * unterminated reasoning block is a finished thought.
 */
export function useReasoningContent(
  text: string,
  isResponseGenerating: boolean,
) {
  const [settings] = usePubSub(settingsPubSub);

  const extractReasoningAndMainContent = useCallback(
    (text: string, startMarker: string, endMarker: string) => {
      const { reasoning, answer, isOpen } = splitReasoning(
        text,
        startMarker,
        endMarker,
      );

      return {
        reasoningContent: reasoning,
        mainContent: answer,
        isGenerating: isOpen && isResponseGenerating,
      };
    },
    [isResponseGenerating],
  );

  if (text && text.trim() === "") {
    return {
      reasoningContent: "",
      mainContent: "",
      isGenerating: false,
    };
  }

  if (!text) {
    return {
      reasoningContent: "",
      mainContent: "",
      isGenerating: false,
    };
  }

  const result = extractReasoningAndMainContent(
    text,
    settings.reasoningStartMarker,
    settings.reasoningEndMarker,
  );

  return result;
}
