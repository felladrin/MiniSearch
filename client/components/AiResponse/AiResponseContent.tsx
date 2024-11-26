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
  IconVolume2,
} from "@tabler/icons-react";
import type { PublishFunction } from "create-pubsub";
import { usePubSub } from "create-pubsub/react";
import { type ReactNode, Suspense, lazy, useMemo, useState } from "react";
import { match } from "ts-pattern";
import { settingsPubSub } from "../../modules/pubSub";
import { searchAndRespond } from "../../modules/textGeneration";

const FormattedMarkdown = lazy(() => import("./FormattedMarkdown"));
const CopyIconButton = lazy(() => import("./CopyIconButton"));

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
  const [isSpeaking, setIsSpeaking] = useState(false);

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

  function speakResponse(text: string) {
    if (isSpeaking) {
      self.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const cleanText = text.replace(/[#*`_~\[\]]/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);

    const voices = self.speechSynthesis.getVoices();

    if (voices.length > 0 && settings.selectedVoiceId) {
      const voice = voices.find(
        (voice) => voice.voiceURI === settings.selectedVoiceId,
      );

      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
    }

    utterance.onend = () => setIsSpeaking(false);

    setIsSpeaking(true);
    self.speechSynthesis.speak(utterance);
  }

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
            <Tooltip
              label={isSpeaking ? "Stop speaking" : "Listen to response"}
            >
              <ActionIcon
                onClick={() => speakResponse(response)}
                variant="subtle"
                color={isSpeaking ? "blue" : "gray"}
              >
                <IconVolume2 size={16} />
              </ActionIcon>
            </Tooltip>
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
            <Suspense>
              <CopyIconButton value={response} tooltipLabel="Copy response" />
            </Suspense>
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
