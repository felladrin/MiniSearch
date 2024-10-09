import { usePubSub } from "create-pubsub/react";
import { lazy, Suspense, useMemo } from "react";
import { match, Pattern } from "ts-pattern";
import {
  modelLoadingProgressPubSub,
  responsePubSub,
  settingsPubSub,
  queryPubSub,
  textGenerationStatePubSub,
} from "../../modules/pubSub";
import ChatInterface from "./ChatInterface";

const AiResponseContent = lazy(() => import("./AiResponseContent"));
const PreparingContent = lazy(() => import("./PreparingContent"));
const LoadingModelContent = lazy(() => import("./LoadingModelContent"));

export default function AiResponseSection() {
  const [query] = usePubSub(queryPubSub);
  const [response] = usePubSub(responsePubSub);
  const [textGenerationState, setTextGenerationState] = usePubSub(
    textGenerationStatePubSub,
  );
  const [modelLoadingProgress] = usePubSub(modelLoadingProgressPubSub);
  const [settings] = usePubSub(settingsPubSub);

  return useMemo(
    () =>
      match([settings.enableAiResponse, textGenerationState])
        .with([true, Pattern.not("idle").select()], (textGenerationState) =>
          match(textGenerationState)
            .with(
              Pattern.union("generating", "interrupted", "completed", "failed"),
              (textGenerationState) => (
                <>
                  <Suspense>
                    <AiResponseContent
                      textGenerationState={textGenerationState}
                      response={response}
                      setTextGenerationState={setTextGenerationState}
                    />
                  </Suspense>
                  {textGenerationState === "completed" && (
                    <ChatInterface
                      initialQuery={query}
                      initialResponse={response}
                    />
                  )}
                </>
              ),
            )
            .with("loadingModel", () => (
              <Suspense>
                <LoadingModelContent
                  modelLoadingProgress={modelLoadingProgress}
                />
              </Suspense>
            ))
            .with(
              Pattern.union("awaitingSearchResults", "preparingToGenerate"),
              (textGenerationState) => (
                <Suspense>
                  <PreparingContent textGenerationState={textGenerationState} />
                </Suspense>
              ),
            )
            .exhaustive(),
        )
        .otherwise(() => null),
    [
      settings,
      textGenerationState,
      setTextGenerationState,
      modelLoadingProgress,
      response,
      query,
    ],
  );
}
