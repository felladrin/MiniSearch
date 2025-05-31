import { Paper, Stack } from "@mantine/core";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { Suspense, lazy, memo } from "react";

const FormattedMarkdown = lazy(() => import("./FormattedMarkdown"));

interface MessageListProps {
  messages: ChatMessage[];
}

const MessageList = memo(function MessageList({ messages }: MessageListProps) {
  if (messages.length <= 2) return null;

  return (
    <Stack gap="md">
      {messages
        .slice(2)
        .filter((message) => message.content.length > 0)
        .map((message, index) => (
          <Paper
            key={`${message.role}-${index}`}
            shadow="xs"
            radius="xl"
            p="sm"
            maw="90%"
            style={{
              alignSelf: message.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <Suspense fallback={message.content}>
              <FormattedMarkdown>{message.content}</FormattedMarkdown>
            </Suspense>
          </Paper>
        ))}
    </Stack>
  );
});

export default MessageList;
