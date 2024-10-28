import { usePubSub } from "create-pubsub/react";
import { Suspense, lazy, useMemo } from "react";
import { Pattern, match } from "ts-pattern";
import {
  modelLoadingProgressPubSub,
  modelSizeInMegabytesPubSub,
  queryPubSub,
  responsePubSub,
  settingsPubSub,
  textGenerationStatePubSub,
} from "../../modules/pubSub";

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
                    <Suspense>
                      <ChatInterface
                        initialQuery={query}
                        initialResponse={response}
                      />
                    </Suspense>
                  )}
                </>
              ),
            )
            .with("awaitingModelDownloadAllowance", () => (
              <Suspense>
                <AiModelDownloadAllowanceContent />
              </Suspense>
            ))
            .with("loadingModel", () => (
              <Suspense>
                <LoadingModelContent
                  modelLoadingProgress={modelLoadingProgress}
                  modelSizeInMegabytes={modelSizeInMegabytes}
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
      modelSizeInMegabytes,
    ],
  );
}
