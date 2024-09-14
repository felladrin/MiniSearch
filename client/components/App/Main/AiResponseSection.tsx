import { usePubSub } from "create-pubsub/react";
import {
  modelLoadingProgressPubSub,
  responsePubSub,
  textGenerationStatePubSub,
  settingsPubSub,
} from "../../../modules/pubSub";
import Markdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import syntaxHighlighterStyle from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import { match, Pattern } from "ts-pattern";
import {
  Stack,
  Divider,
  Skeleton,
  Alert,
  Progress,
  Button,
  Center,
  TypographyStylesProvider,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useMemo } from "react";
import { PublishFunction } from "create-pubsub";

export function AiResponseSection() {
  const [response] = usePubSub(responsePubSub);
  const [textGenerationState, setTextGenerationState] = usePubSub(
    textGenerationStatePubSub,
  );
  const [modelLoadingProgress] = usePubSub(modelLoadingProgressPubSub);
  const [settings] = usePubSub(settingsPubSub);

  return useMemo(
    () =>
      match([settings.enableAiResponse, textGenerationState])
        .with([true, Pattern.not("idle")], () =>
          match(textGenerationState)
            .with(
              Pattern.union("generating", "interrupted", "completed", "failed"),
              (textGenerationState) => (
                <AiResponseContent
                  textGenerationState={textGenerationState}
                  response={response}
                  setTextGenerationState={setTextGenerationState}
                />
              ),
            )
            .with("loadingModel", () => (
              <LoadingModelContent
                modelLoadingProgress={modelLoadingProgress}
              />
            ))
            .with(
              Pattern.union("awaitingSearchResults", "preparingToGenerate"),
              (textGenerationState) => (
                <PreparingContent textGenerationState={textGenerationState} />
              ),
            )
            .otherwise(() => null),
        )
        .otherwise(() => null),
    [
      settings,
      textGenerationState,
      setTextGenerationState,
      modelLoadingProgress,
      response,
    ],
  );
}

function AiResponseContent({
  textGenerationState,
  response,
  setTextGenerationState,
}: {
  textGenerationState: string;
  response: string;
  setTextGenerationState: PublishFunction<
    | "failed"
    | "awaitingSearchResults"
    | "preparingToGenerate"
    | "idle"
    | "loadingModel"
    | "generating"
    | "interrupted"
    | "completed"
  >;
}) {
  return (
    <>
      <Divider
        variant="dashed"
        labelPosition="center"
        label={match(textGenerationState)
          .with("generating", () => "Generating AI Response...")
          .with("interrupted", () => "AI Response (Interrupted)")
          .otherwise(() => "AI Response")}
      />
      <Stack gap="xs">
        {match(textGenerationState)
          .with("generating", () => (
            <Center>
              <Button
                variant="default"
                size="xs"
                onClick={() => setTextGenerationState("interrupted")}
              >
                Stop generating
              </Button>
            </Center>
          ))
          .otherwise(() => null)}
        <TypographyStylesProvider>
          <Markdown
            components={{
              code(props) {
                const { children, className, node, ref, ...rest } = props;
                void node;
                const languageMatch = /language-(\w+)/.exec(className || "");
                return languageMatch ? (
                  <SyntaxHighlighter
                    {...rest}
                    ref={ref as never}
                    children={children?.toString().replace(/\n$/, "") ?? ""}
                    language={languageMatch[1]}
                    style={syntaxHighlighterStyle}
                  />
                ) : (
                  <code {...rest} className={className}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {response}
          </Markdown>
        </TypographyStylesProvider>
        {match(textGenerationState)
          .with("failed", () => (
            <Alert
              variant="light"
              color="yellow"
              title="Failed to generate response"
              icon={<IconInfoCircle />}
            >
              Could not generate response. It's possible that your browser or
              your system is out of memory.
            </Alert>
          ))
          .otherwise(() => null)}
      </Stack>
    </>
  );
}

function LoadingModelContent({
  modelLoadingProgress,
}: {
  modelLoadingProgress: number;
}) {
  const isLoadingComplete =
    modelLoadingProgress === 100 || modelLoadingProgress === 0;
  const percent = isLoadingComplete ? 100 : modelLoadingProgress;
  const strokeColor = isLoadingComplete ? "#52c41a" : "#3385ff";

  return (
    <>
      <Divider
        mb="sm"
        variant="dashed"
        labelPosition="center"
        label="Loading AI..."
      />
      <Progress color={strokeColor} value={percent} />
    </>
  );
}

function PreparingContent({
  textGenerationState,
}: {
  textGenerationState: string;
}) {
  return (
    <>
      <Divider
        mb="sm"
        variant="dashed"
        labelPosition="center"
        label={match(textGenerationState)
          .with("awaitingSearchResults", () => "Awaiting search results...")
          .with("preparingToGenerate", () => "Preparing AI response...")
          .otherwise(() => null)}
      />
      <Stack>
        <Skeleton height={8} radius="xl" />
        <Skeleton height={8} width="70%" radius="xl" />
        <Skeleton height={8} radius="xl" />
        <Skeleton height={8} width="43%" radius="xl" />
      </Stack>
    </>
  );
}
