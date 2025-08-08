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
import { type ReactNode, useMemo, useState } from "react";
import { addLogEntry } from "../../modules/logEntries";
import { settingsPubSub } from "../../modules/pubSub";
import { searchAndRespond } from "../../modules/textGeneration";
import CopyIconButton from "./CopyIconButton";
import FormattedMarkdown from "./FormattedMarkdown";

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

    const prepareTextForSpeech = (textToClean: string) => {
      const withoutReasoning = textToClean.replace(
        new RegExp(
          `${settings.reasoningStartMarker}[\\s\\S]*?${settings.reasoningEndMarker}`,
          "g",
        ),
        "",
      );
      const withoutLinks = withoutReasoning.replace(
        /\[([^\]]+)\]\([^)]+\)/g,
        "($1)",
      );
      const withoutMarkdown = withoutLinks.replace(/[#*`_~[\]]/g, "");
      return withoutMarkdown.trim();
    };

    const utterance = new SpeechSynthesisUtterance(prepareTextForSpeech(text));

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

    utterance.onerror = () => {
      addLogEntry("Failed to speak response");
      setIsSpeaking(false);
    };

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
                  onClick={() => setTextGenerationState("interrupted")}
                  variant="subtle"
                  color="gray"
                >
                  <IconHandStop size={16} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Tooltip label="Regenerate response">
                <ActionIcon
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
            <CopyIconButton value={response} tooltipLabel="Copy response" />
          </Group>
        </Group>
      </Card.Section>
      <Card.Section withBorder>
        <ConditionalScrollArea>
          <FormattedMarkdown>{response}</FormattedMarkdown>
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
