import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Card,
  CopyButton,
  Group,
  ScrollArea,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowsMaximize,
  IconCheck,
  IconCopy,
  IconHandStop,
  IconInfoCircle,
} from "@tabler/icons-react";
import { PublishFunction } from "create-pubsub";
import { lazy, ReactNode, Suspense, useMemo, useState } from "react";
import { match } from "ts-pattern";

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
  const [isScrollAreaEnabled, setScrollAreaEnabled] = useState(true);

  const ConditionalScrollArea = useMemo(
    () =>
      ({ children }: { children: ReactNode }) => {
        return isScrollAreaEnabled ? (
          <ScrollArea.Autosize mah={300} type="auto" offsetScrollbars>
            {children}
          </ScrollArea.Autosize>
        ) : (
          <Box>{children}</Box>
        );
      },
    [isScrollAreaEnabled],
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
            {isScrollAreaEnabled && (
              <Tooltip label="Show full response without scroll bar">
                <ActionIcon
                  onClick={() => setScrollAreaEnabled(false)}
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
