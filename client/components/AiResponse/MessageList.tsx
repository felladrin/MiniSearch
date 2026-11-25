import { ActionIcon, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { IconPencil, IconRefresh } from "@tabler/icons-react";
import { memo } from "react";
import type { ChatMessage } from "@/modules/types";
import FormattedMarkdown from "./FormattedMarkdown";

interface MessageListProps {
  messages: ChatMessage[];
  /** Position of the first follow-up message: 2 after the main question and answer, 0 without them. */
  followUpStartIndex: number;
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
          {message.content.length > 0 ? (
            <FormattedMarkdown isGenerating={isGenerating && isLastAssistant}>
              {message.content}
            </FormattedMarkdown>
          ) : (
            <Text c="dimmed" fs="italic" size="sm">
              No response
            </Text>
          )}
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
  followUpStartIndex,
  onEditMessage,
  onRegenerate,
  isGenerating,
}: MessageListProps) {
  if (messages.length <= followUpStartIndex) return null;

  return (
    <Stack gap="md">
      {messages.map((message, absoluteIndex) => {
        // The index is the message's position in `messages`, which is what
        // editing and regenerating act on. Messages before the follow-ups are
        // shown above the chat, so they don't render here but keep their
        // position.
        if (absoluteIndex < followUpStartIndex) return null;
        const isLastAssistant =
          absoluteIndex === messages.length - 1 && message.role === "assistant";
        // An empty message has nothing to show, except a finished last answer:
        // it renders as "No response" so its Re-generate button has a row. A
        // trailing empty answer while generating is the stream placeholder.
        if (message.content.length === 0 && !(isLastAssistant && !isGenerating))
          return null;
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
