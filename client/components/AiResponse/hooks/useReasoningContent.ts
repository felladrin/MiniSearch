import { usePubSub } from "create-pubsub/react";
import { useCallback } from "react";
import { settingsPubSub } from "../../../modules/pubSub";

export function useReasoningContent(text: string) {
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
          isGenerating: true,
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
    [],
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
