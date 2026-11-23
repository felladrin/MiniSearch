import { usePubSub } from "create-pubsub/react";
import { useCallback } from "react";
import { settingsPubSub } from "@/modules/pubSub";

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
      if (!text)
        return { reasoningContent: "", mainContent: "", isGenerating: false };

      const trimmedText = text.trim();

      if (!trimmedText.startsWith(startMarker))
        return { reasoningContent: "", mainContent: text, isGenerating: false };

      const startIndex = trimmedText.indexOf(startMarker);
      const endIndex = trimmedText.indexOf(endMarker);

      if (endIndex === -1) {
        return {
          reasoningContent: trimmedText.slice(startIndex + startMarker.length),
          mainContent: "",
          isGenerating: isResponseGenerating,
        };
      }

      return {
        reasoningContent: trimmedText.slice(
          startIndex + startMarker.length,
          endIndex,
        ),
        mainContent: trimmedText.slice(endIndex + endMarker.length),
        isGenerating: false,
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
