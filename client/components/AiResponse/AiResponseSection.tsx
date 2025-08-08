import { CodeHighlightAdapterProvider } from "@mantine/code-highlight";
import { usePubSub } from "create-pubsub/react";
import { useMemo } from "react";
import {
  modelLoadingProgressPubSub,
  modelSizeInMegabytesPubSub,
  queryPubSub,
  responsePubSub,
  settingsPubSub,
  textGenerationStatePubSub,
} from "../../modules/pubSub";
import { shikiAdapter } from "../../modules/shiki";
import "@mantine/code-highlight/styles.css";
import AiModelDownloadAllowanceContent from "./AiModelDownloadAllowanceContent";
import AiResponseContent from "./AiResponseContent";
import ChatInterface from "./ChatInterface";
import LoadingModelContent from "./LoadingModelContent";
import PreparingContent from "./PreparingContent";

export default function AiResponseSection() {
  const [query] = usePubSub(queryPubSub);
  const [response] = usePubSub(responsePubSub);
  const [textGenerationState, setTextGenerationState] = usePubSub(
    textGenerationStatePubSub,
  );
  const [modelLoadingProgress] = usePubSub(modelLoadingProgressPubSub);
  const [settings] = usePubSub(settingsPubSub);
  const [modelSizeInMegabytes] = usePubSub(modelSizeInMegabytesPubSub);

  return useMemo(() => {
    if (!settings.enableAiResponse || textGenerationState === "idle") {
      return null;
    }

    const generatingStates = [
      "generating",
      "interrupted",
      "completed",
      "failed",
    ];
    if (generatingStates.includes(textGenerationState)) {
      return (
        <CodeHighlightAdapterProvider adapter={shikiAdapter}>
          <AiResponseContent
            textGenerationState={textGenerationState}
            response={response}
            setTextGenerationState={setTextGenerationState}
          />

          {textGenerationState === "completed" && (
            <ChatInterface initialQuery={query} initialResponse={response} />
          )}
        </CodeHighlightAdapterProvider>
      );
    }

    if (textGenerationState === "loadingModel") {
      return (
        <LoadingModelContent
          modelLoadingProgress={modelLoadingProgress}
          modelSizeInMegabytes={modelSizeInMegabytes}
        />
      );
    }

    if (textGenerationState === "preparingToGenerate") {
      return <PreparingContent textGenerationState={textGenerationState} />;
    }

    if (textGenerationState === "awaitingSearchResults") {
      return <PreparingContent textGenerationState={textGenerationState} />;
    }

    if (textGenerationState === "awaitingModelDownloadAllowance") {
      return <AiModelDownloadAllowanceContent />;
    }

    return null;
  }, [
    settings.enableAiResponse,
    textGenerationState,
    response,
    query,
    modelLoadingProgress,
    modelSizeInMegabytes,
    setTextGenerationState,
  ]);
}
