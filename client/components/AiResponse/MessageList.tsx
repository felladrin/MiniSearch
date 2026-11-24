import { ActionIcon, Group, Paper, Stack, Tooltip } from "@mantine/core";
import { IconPencil, IconRefresh } from "@tabler/icons-react";
import { memo } from "react";
import type { ChatMessage } from "@/modules/types";
import FormattedMarkdown from "./FormattedMarkdown";

interface MessageListProps {
  messages: ChatMessage[];
  onEditMessage: (absoluteIndex: number) => void;
  onRegenerate: () => void;
  isGenerating: boolean;
}

interface MessageProps {
  message: ChatMessage;
  absoluteIndex: number;
  isLastAssistant: boolean;
  isGenerating: boolean;
  onEditMessage: (absoluteIndex: number) => void;
  onRegenerate: () => void;
}

const Message = memo(
  ({
    message,
    absoluteIndex,
    isLastAssistant,
    isGenerating,
    onEditMessage,
    onRegenerate,
  }: MessageProps) => {
    const canEdit = message.role === "user";
    const canRegenerate = isLastAssistant && message.role === "assistant";
    const iconSize = 16;
    const iconVariant: "subtle" = "subtle";

    return (
      <Group
        gap="xs"
        align="center"
        w="100%"
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
          key={`${message.role}-${absoluteIndex}`}
          shadow="xs"
          radius="xl"
          p="sm"
          style={{ flex: 1, overflow: "auto" }}
        >
          <FormattedMarkdown isGenerating={isGenerating && isLastAssistant}>
            {message.content}
          </FormattedMarkdown>
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
  },
);

const MessageList = memo(function MessageList({
  messages,
  onEditMessage,
  onRegenerate,
  isGenerating,
}: MessageListProps) {
  if (messages.length <= 2) return null;

  return (
    <Stack gap="md">
      {messages.map((message, absoluteIndex) => {
        // The index is the message's position in `messages`, which is what
        // editing and regenerating act on. The first two messages are the
        // system prompt and its acknowledgement, and an empty message has
        // nothing to show, so neither renders, but both keep their position.
        if (absoluteIndex < 2 || message.content.length === 0) return null;
        const isLastAssistant =
          absoluteIndex === messages.length - 1 && message.role === "assistant";
        return (
          <Message
            // biome-ignore lint/suspicious/noArrayIndexKey: a message's position in the chat is its identity
            key={absoluteIndex}
            message={message}
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
