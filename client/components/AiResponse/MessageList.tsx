import { ActionIcon, Group, Paper, Stack, Tooltip } from "@mantine/core";
import { IconPencil, IconRefresh } from "@tabler/icons-react";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { memo } from "react";
import FormattedMarkdown from "./FormattedMarkdown";

interface MessageListProps {
  messages: ChatMessage[];
  onEditMessage: (absoluteIndex: number) => void;
  onRegenerate: () => void;
  isGenerating: boolean;
}

interface MessageProps {
  message: ChatMessage;
  index: number;
  absoluteIndex: number;
  isLastAssistant: boolean;
  isGenerating: boolean;
  onEditMessage: (absoluteIndex: number) => void;
  onRegenerate: () => void;
}

const Message = memo(function Message({
  message,
  index,
  absoluteIndex,
  isLastAssistant,
  isGenerating,
  onEditMessage,
  onRegenerate,
}: MessageProps) {
  const canEdit = message.role === "user";
  const canRegenerate = isLastAssistant && message.role === "assistant";
  const iconSize = 16;
  const iconVariant: "subtle" = "subtle";

  return (
    <Group
      gap="xs"
      align="center"
      justify={message.role === "user" ? "flex-end" : "flex-start"}
    >
      {canEdit && (
        <Tooltip label="Edit" withArrow position="right" openDelay={300}>
          <ActionIcon
            aria-label="Edit message"
            color="gray"
            variant={iconVariant}
            disabled={isGenerating}
            onClick={() => onEditMessage(absoluteIndex)}
          >
            <IconPencil size={iconSize} />
          </ActionIcon>
        </Tooltip>
      )}

      <Paper
        key={`${message.role}-${index}`}
        shadow="xs"
        radius="xl"
        p="sm"
        maw="90%"
      >
        <FormattedMarkdown>{message.content}</FormattedMarkdown>
      </Paper>

      {canRegenerate && (
        <Tooltip
          label="Re-generate response"
          withArrow
          position="left"
          openDelay={300}
        >
          <ActionIcon
            aria-label="Re-generate response"
            color="gray"
            variant={iconVariant}
            disabled={isGenerating}
            onClick={() => onRegenerate()}
          >
            <IconRefresh size={iconSize} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
});

const MessageList = memo(function MessageList({
  messages,
  onEditMessage,
  onRegenerate,
  isGenerating,
}: MessageListProps) {
  if (messages.length <= 2) return null;

  return (
    <Stack gap="md">
      {messages
        .slice(2)
        .filter((message) => message.content.length > 0)
        .map((message, index) => {
          const absoluteIndex = index + 2;
          const isLastAssistant =
            absoluteIndex === messages.length - 1 &&
            message.role === "assistant";
          return (
            <Message
              key={`${message.role}-${index}`}
              message={message}
              index={index}
              absoluteIndex={absoluteIndex}
              isLastAssistant={isLastAssistant}
              isGenerating={isGenerating}
              onEditMessage={onEditMessage}
              onRegenerate={onRegenerate}
            />
          );
        })}
    </Stack>
  );
});

export default MessageList;
