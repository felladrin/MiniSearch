import { Group, Text } from "@mantine/core";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { Suspense, lazy } from "react";

const CopyIconButton = lazy(() => import("./CopyIconButton"));

interface ChatHeaderProps {
  messages: ChatMessage[];
}

function ChatHeader({ messages }: ChatHeaderProps) {
  const getChatContent = () => {
    return messages
      .slice(2)
      .map(
        (msg, index) =>
          `${index + 1}. ${msg.role?.toUpperCase()}\n\n${msg.content}`,
      )
      .join("\n\n");
  };

  return (
    <Group justify="space-between">
      <Text fw={500}>Follow-up questions</Text>
      {messages.length > 2 && (
        <Suspense fallback={<Text size="xs">Loading...</Text>}>
          <CopyIconButton
            value={getChatContent()}
            tooltipLabel="Copy conversation"
          />
        </Suspense>
      )}
    </Group>
  );
}

export default ChatHeader;
