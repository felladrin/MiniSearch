import { usePubSub } from "create-pubsub/react";
import { useCallback } from "react";
import { settingsPubSub } from "../../../modules/pubSub";

export function useReasoningContent(text: string) {
  const [settings] = usePubSub(settingsPubSub);

  const extractReasoningAndMainContent = useCallback(
    (text: string, startMarker: string, endMarker: string) => {
      if (!text)
        return { reasoningContent: "", mainContent: "", isGenerating: false };

      if (!text.trim().startsWith(startMarker))
        return { reasoningContent: "", mainContent: text, isGenerating: false };

      const endIndex = text.indexOf(endMarker);

      if (endIndex === -1) {
        return {
          reasoningContent: text.slice(startMarker.length),
          mainContent: "",
          isGenerating: true,
        };
      }

      return {
        reasoningContent: text.slice(startMarker.length, endIndex),
        mainContent: text.slice(endIndex + endMarker.length),
        isGenerating: false,
      };
    },
    [],
  );

  const result = extractReasoningAndMainContent(
    text,
    settings.reasoningStartMarker,
    settings.reasoningEndMarker,
  );

  return result;
}
