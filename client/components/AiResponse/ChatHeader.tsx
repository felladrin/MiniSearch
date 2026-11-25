import { Group, Text } from "@mantine/core";
import type { ChatMessage } from "@/modules/types";
import CopyIconButton from "./CopyIconButton";

interface ChatHeaderProps {
  messages: ChatMessage[];
  /** Position of the first follow-up message: 2 after the main question and answer, 0 without them. */
  followUpStartIndex: number;
}

function ChatHeader({ messages, followUpStartIndex }: ChatHeaderProps) {
  const getChatContent = () => {
    return messages
      .slice(followUpStartIndex)
      .map(
        (msg, index) =>
          `${index + 1}. ${msg.role?.toUpperCase()}\n\n${msg.content}`,
      )
      .join("\n\n");
  };

  return (
    <Group justify="space-between">
      <Text fw={500}>Follow-up questions</Text>
      {messages.length > followUpStartIndex && (
        <CopyIconButton
          value={getChatContent()}
          tooltipLabel="Copy conversation"
        />
      )}
    </Group>
  );
}

export default ChatHeader;
