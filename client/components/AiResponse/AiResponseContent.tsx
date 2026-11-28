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
  IconDownload,
  IconHandStop,
  IconInfoCircle,
  IconMarkdown,
  IconRefresh,
  IconVolume2,
} from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  buildAnswerFileName,
  buildAnswerMarkdown,
  downloadAnswerMarkdown,
} from "@/modules/answerExport";
import {
  getLlmTextSearchResults,
  getQuery,
  settingsPubSub,
  textToSpeechStatePubSub,
} from "@/modules/pubSub";
import { splitReasoning } from "@/modules/reasoning";
import { interruptSearch, searchAndRespond } from "@/modules/textGeneration";
import { imageResultTag } from "@/modules/textGenerationUtilities";
import { speak } from "@/modules/textToSpeech";
import type { TextSearchResults } from "@/modules/types";
import CopyIconButton from "./CopyIconButton";
import FormattedMarkdown from "./FormattedMarkdown";

export default function AiResponseContent({
  textGenerationState,
  response,
}: {
  textGenerationState: string;
  response: string;
}) {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [textToSpeechState] = usePubSub(textToSpeechStatePubSub);
  const isSpeaking = textToSpeechState === "speaking";
  const isGenerating = textGenerationState === "generating";
  const isCompleted = textGenerationState === "completed";
  const query = getQuery();
  // Taken when the answer finishes: a follow-up replaces the live list with
  // its own results, and this card still shows the first answer. The image
  // tag is the prompt's own marker, not part of a title.
  const [answerSources, setAnswerSources] = useState<TextSearchResults>([]);
  useEffect(() => {
    if (!isCompleted || !response) return;
    setAnswerSources(
      getLlmTextSearchResults().map(([title, snippet, url]) => [
        title.startsWith(imageResultTag)
          ? title.slice(imageResultTag.length)
          : title,
        snippet,
        url,
      ]),
    );
  }, [isCompleted, response]);
  const exportMarkdown = useMemo(
    () =>
      isCompleted
        ? buildAnswerMarkdown({
            // The answer only: the reasoning block stays out of the file, as
            // it stays folded on the card.
            answer: splitReasoning(
              response,
              settings.reasoningStartMarker,
              settings.reasoningEndMarker,
            ).answer,
            sources: answerSources,
            query,
            exportedAt: new Date(),
          })
        : "",
    [
      isCompleted,
      response,
      answerSources,
      query,
      settings.reasoningStartMarker,
      settings.reasoningEndMarker,
    ],
  );

  const ConditionalScrollArea = useMemo(
    () =>
      ({ children }: { children: ReactNode }) => {
        return settings.enableAiResponseScrolling ? (
          <ScrollArea.Autosize
            mah={300}
            type="auto"
            scrollbars="y"
            offsetScrollbars
          >
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
              {textGenerationState === "generating"
                ? "Generating AI Response..."
                : "AI Response"}
            </Text>
            {textGenerationState === "interrupted" && (
              <Badge variant="light" color="yellow" size="xs">
                Interrupted
              </Badge>
            )}
          </Group>
          <Group gap="xs" align="center">
            {textGenerationState === "generating" ? (
              <Tooltip label="Interrupt generation">
                <ActionIcon
                  aria-label="Interrupt generation"
                  onClick={interruptSearch}
                  variant="subtle"
                  color="gray"
                >
                  <IconHandStop size={16} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Tooltip label="Regenerate response">
                <ActionIcon
                  aria-label="Regenerate response"
                  onClick={() => searchAndRespond()}
                  variant="subtle"
                  color="gray"
                >
                  <IconRefresh size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip
              label={isSpeaking ? "Stop speaking" : "Listen to response"}
            >
              <ActionIcon
                aria-label={isSpeaking ? "Stop speaking" : "Listen to response"}
                onClick={() => speak(response)}
                variant="subtle"
                color={isSpeaking ? "blue" : "gray"}
              >
                <IconVolume2 size={16} />
              </ActionIcon>
            </Tooltip>
            {settings.enableAiResponseScrolling ? (
              <Tooltip label="Show full response without scroll bar">
                <ActionIcon
                  aria-label="Show full response without scroll bar"
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
                  aria-label="Enable scroll bar"
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
            {isCompleted && (
              <>
                <CopyIconButton
                  value={exportMarkdown}
                  tooltipLabel="Copy as Markdown"
                  icon={<IconMarkdown size={16} />}
                />
                <Tooltip
                  label="Download as Markdown"
                  withArrow
                  position="right"
                >
                  <ActionIcon
                    aria-label="Download as Markdown"
                    onClick={() =>
                      downloadAnswerMarkdown(
                        exportMarkdown,
                        buildAnswerFileName(query),
                      )
                    }
                    variant="subtle"
                    color="gray"
                  >
                    <IconDownload size={16} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
          </Group>
        </Group>
      </Card.Section>
      <Card.Section withBorder>
        <ConditionalScrollArea>
          <Box aria-live="polite" aria-busy={isGenerating}>
            <FormattedMarkdown isGenerating={isGenerating}>
              {response}
            </FormattedMarkdown>
          </Box>
        </ConditionalScrollArea>
        {textGenerationState === "failed" && (
          <Alert
            variant="light"
            color="yellow"
            title="Failed to generate response"
            icon={<IconInfoCircle />}
          >
            Could not generate response. Please try refreshing the page.
          </Alert>
        )}
      </Card.Section>
    </Card>
  );
}
