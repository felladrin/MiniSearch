import { Paper, Stack } from "@mantine/core";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { Suspense, lazy, memo } from "react";

const FormattedMarkdown = lazy(() => import("./FormattedMarkdown"));

interface MessageListProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  streamedResponse: string;
}

const MessageList = memo(function MessageList({
  messages,
  isGenerating,
  streamedResponse,
}: MessageListProps) {
  if (messages.length <= 2) return null;

  return (
    <Stack gap="md">
      {messages.slice(2).map((message, index) => (
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
          <Suspense fallback={<div>Loading message...</div>}>
            <FormattedMarkdown>{message.content}</FormattedMarkdown>
          </Suspense>
        </Paper>
      ))}
      {isGenerating && streamedResponse.length > 0 && (
        <Paper
          shadow="xs"
          radius="xl"
          p="sm"
          maw="90%"
          style={{ alignSelf: "flex-start" }}
        >
          <Suspense fallback={<div>Loading response...</div>}>
            <FormattedMarkdown>{streamedResponse}</FormattedMarkdown>
          </Suspense>
        </Paper>
      )}
    </Stack>
  );
});

export default MessageList;
