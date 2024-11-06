import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Card,
  Group,
  ScrollArea,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconHandStop,
  IconInfoCircle,
  IconRefresh,
} from "@tabler/icons-react";
import type { PublishFunction } from "create-pubsub";
import { usePubSub } from "create-pubsub/react";
import { type ReactNode, Suspense, lazy, useMemo } from "react";
import { match } from "ts-pattern";
import { settingsPubSub } from "../../modules/pubSub";
import { searchAndRespond } from "../../modules/textGeneration";
import { CopyIconButton } from "./CopyIconButton";

const FormattedMarkdown = lazy(() => import("./FormattedMarkdown"));

export default function AiResponseContent({
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
  const [settings, setSettings] = usePubSub(settingsPubSub);

  const ConditionalScrollArea = useMemo(
    () =>
      ({ children }: { children: ReactNode }) => {
        return settings.enableAiResponseScrolling ? (
          <ScrollArea.Autosize mah={300} type="auto" offsetScrollbars>
            {children}
          </ScrollArea.Autosize>
        ) : (
          <Box>{children}</Box>
        );
      },
    [settings.enableAiResponseScrolling],
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
              .otherwise(() => (
                <Tooltip label="Regenerate response">
                  <ActionIcon
                    onClick={() => searchAndRespond()}
                    variant="subtle"
                    color="gray"
                  >
                    <IconRefresh size={16} />
                  </ActionIcon>
                </Tooltip>
              ))}
            {settings.enableAiResponseScrolling ? (
              <Tooltip label="Show full response without scroll bar">
                <ActionIcon
                  onClick={() => {
                    setSettings({
                      ...settings,
                      enableAiResponseScrolling: false,
                    });
                  }}
                  variant="subtle"
                  color="gray"
                >
                  <IconArrowsMaximize size={16} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Tooltip label="Enable scroll bar">
                <ActionIcon
                  onClick={() => {
                    setSettings({
                      ...settings,
                      enableAiResponseScrolling: true,
                    });
                  }}
                  variant="subtle"
                  color="gray"
                >
                  <IconArrowsMinimize size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            <CopyIconButton value={response} tooltipLabel="Copy response" />
          </Group>
        </Group>
      </Card.Section>
      <Card.Section withBorder>
        <ConditionalScrollArea>
          <Suspense>
            <FormattedMarkdown>{response}</FormattedMarkdown>
          </Suspense>
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
