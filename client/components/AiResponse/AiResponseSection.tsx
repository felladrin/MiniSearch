import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Card,
  CopyButton,
  Group,
  Progress,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  Tooltip,
  TypographyStylesProvider,
} from "@mantine/core";
import {
  IconArrowsMaximize,
  IconCheck,
  IconCopy,
  IconHandStop,
  IconInfoCircle,
} from "@tabler/icons-react";
import { PublishFunction } from "create-pubsub";
import { usePubSub } from "create-pubsub/react";
import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import syntaxHighlighterStyle from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import { match, Pattern } from "ts-pattern";
import {
  modelLoadingProgressPubSub,
  responsePubSub,
  settingsPubSub,
  textGenerationStatePubSub,
} from "../../modules/pubSub";

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
        .with([true, Pattern.not("idle").select()], (textGenerationState) =>
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
            .exhaustive(),
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
  const [isExpanded, setIsExpanded] = useState(false);

  const removeScrollArea = () => {
    setIsExpanded(true);
  };

  const ConditionalScrollArea = useMemo(
    () =>
      ({ children }: { children: React.ReactNode }) => {
        return isExpanded ? (
          <Box>{children}</Box>
        ) : (
          <ScrollArea.Autosize mah={300} type="auto" offsetScrollbars>
            {children}
          </ScrollArea.Autosize>
        );
      },
    [isExpanded],
  );

  return (
    <Card withBorder shadow="sm" radius="md">
      <Card.Section withBorder inheritPadding py="xs">
        <Group justify="space-between">
          <Group gap="xs" align="center">
            <Text fw={500}>
              {match(textGenerationState)
                .with("generating", () => "Generating AI Response...")
                .otherwise(() => "AI Response")}
            </Text>
            {match(textGenerationState)
              .with("interrupted", () => (
                <Badge variant="light" color="yellow" size="xs">
                  Interrupted
                </Badge>
              ))
              .otherwise(() => null)}
          </Group>
          <Group gap="xs" align="center">
            {match(textGenerationState)
              .with("generating", () => (
                <Tooltip label="Interrupt generation">
                  <ActionIcon
                    onClick={() => setTextGenerationState("interrupted")}
                    variant="subtle"
                    color="gray"
                  >
                    <IconHandStop size={16} />
                  </ActionIcon>
                </Tooltip>
              ))
              .otherwise(() => null)}
            {!isExpanded && (
              <Tooltip label="Show full response without scroll bar">
                <ActionIcon
                  onClick={removeScrollArea}
                  variant="subtle"
                  color="gray"
                >
                  <IconArrowsMaximize size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            <CopyButton value={response} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip
                  label={copied ? "Copied" : "Copy response"}
                  withArrow
                  position="right"
                >
                  <ActionIcon
                    color={copied ? "teal" : "gray"}
                    variant="subtle"
                    onClick={copy}
                  >
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
        </Group>
      </Card.Section>
      <Card.Section withBorder>
        <ConditionalScrollArea>
          <TypographyStylesProvider p="md">
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
        </ConditionalScrollArea>
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
      </Card.Section>
    </Card>
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
    <Card withBorder shadow="sm" radius="md">
      <Card.Section withBorder inheritPadding py="xs">
        <Text fw={500}>Loading AI...</Text>
      </Card.Section>
      <Card.Section withBorder inheritPadding py="md">
        <Progress color={strokeColor} value={percent} animated />
      </Card.Section>
    </Card>
  );
}

function PreparingContent({
  textGenerationState,
}: {
  textGenerationState: string;
}) {
  return (
    <Card withBorder shadow="sm" radius="md">
      <Card.Section withBorder inheritPadding py="xs">
        <Text fw={500}>
          {match(textGenerationState)
            .with("awaitingSearchResults", () => "Awaiting search results...")
            .with("preparingToGenerate", () => "Preparing AI response...")
            .otherwise(() => null)}
        </Text>
      </Card.Section>
      <Card.Section withBorder inheritPadding py="md">
        <Stack>
          <Skeleton height={8} radius="xl" />
          <Skeleton height={8} width="70%" radius="xl" />
          <Skeleton height={8} radius="xl" />
          <Skeleton height={8} width="43%" radius="xl" />
        </Stack>
      </Card.Section>
    </Card>
  );
}
