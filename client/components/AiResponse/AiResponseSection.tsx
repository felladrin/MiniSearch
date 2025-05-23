import { CodeHighlightAdapterProvider } from "@mantine/code-highlight";
import { usePubSub } from "create-pubsub/react";
import { Suspense, lazy, useMemo } from "react";
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

const AiResponseContent = lazy(() => import("./AiResponseContent"));
const PreparingContent = lazy(() => import("./PreparingContent"));
const LoadingModelContent = lazy(() => import("./LoadingModelContent"));
const ChatInterface = lazy(() => import("./ChatInterface"));
const AiModelDownloadAllowanceContent = lazy(
  () => import("./AiModelDownloadAllowanceContent"),
);

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
          <Suspense>
            <AiResponseContent
              textGenerationState={textGenerationState}
              response={response}
              setTextGenerationState={setTextGenerationState}
            />
          </Suspense>
          {textGenerationState === "completed" && (
            <Suspense>
              <ChatInterface initialQuery={query} initialResponse={response} />
            </Suspense>
          )}
        </CodeHighlightAdapterProvider>
      );
    }

    if (textGenerationState === "loadingModel") {
      return (
        <Suspense>
          <LoadingModelContent
            modelLoadingProgress={modelLoadingProgress}
            modelSizeInMegabytes={modelSizeInMegabytes}
          />
        </Suspense>
      );
    }

    if (textGenerationState === "preparingToGenerate") {
      return (
        <Suspense>
          <PreparingContent textGenerationState={textGenerationState} />
        </Suspense>
      );
    }

    if (textGenerationState === "awaitingSearchResults") {
      return (
        <Suspense>
          <PreparingContent textGenerationState={textGenerationState} />
        </Suspense>
      );
    }

    if (textGenerationState === "awaitingModelDownloadAllowance") {
      return (
        <Suspense>
          <AiModelDownloadAllowanceContent />
        </Suspense>
      );
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
