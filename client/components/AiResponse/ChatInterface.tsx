import { Card, Stack, Text } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import {
  type ChangeEvent,
  type KeyboardEvent,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
} from "react";
import { ErrorBoundary } from "react-error-boundary";
import { handleEnterKeyDown } from "../../modules/keyboard";
import { addLogEntry } from "../../modules/logEntries";
import { settingsPubSub } from "../../modules/pubSub";
import { generateChatResponse } from "../../modules/textGeneration";

const ChatHeader = lazy(() => import("./ChatHeader"));
const MessageList = lazy(() => import("./MessageList"));
const ChatInputArea = lazy(() => import("./ChatInputArea"));

interface ChatState {
  input: string;
  isGenerating: boolean;
  streamedResponse: string;
}

export default function ChatInterface({
  initialQuery,
  initialResponse,
}: {
  initialQuery: string;
  initialResponse: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<ChatState>({
    input: "",
    isGenerating: false,
    streamedResponse: "",
  });
  const latestResponseRef = useRef("");
  const [settings] = usePubSub(settingsPubSub);

  useEffect(() => {
    setMessages([
      { role: "user", content: initialQuery },
      { role: "assistant", content: initialResponse },
    ]);
  }, [initialQuery, initialResponse]);

  const handleSend = async () => {
    if (state.input.trim() === "" || state.isGenerating) return;

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: state.input },
    ];
    setMessages(newMessages);
    setState((prev) => ({
      ...prev,
      input: "",
      isGenerating: true,
      streamedResponse: "",
    }));
    latestResponseRef.current = "";

    try {
      addLogEntry("User sent a follow-up question");
      await generateChatResponse(newMessages, (partialResponse) => {
        setState((prev) => ({ ...prev, streamedResponse: partialResponse }));
        latestResponseRef.current = partialResponse;
      });
      setMessages((prevMessages) => [
        ...prevMessages,
        { role: "assistant", content: latestResponseRef.current },
      ]);
      addLogEntry("AI responded to follow-up question");
    } catch (error) {
      addLogEntry(`Error generating chat response: ${error}`);
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          role: "assistant",
          content: "Sorry, I encountered an error while generating a response.",
        },
      ]);
    } finally {
      setState((prev) => ({
        ...prev,
        isGenerating: false,
        streamedResponse: "",
      }));
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const input = event.target.value;
    setState((prev) => ({ ...prev, input }));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    handleEnterKeyDown(event, settings, handleSend);
  };

  return (
    <Card withBorder shadow="sm" radius="md">
      <Card.Section withBorder inheritPadding py="xs">
        <Suspense fallback={<Text>Loading header...</Text>}>
          <ChatHeader messages={messages} />
        </Suspense>
      </Card.Section>
      <Stack gap="md" pt="md">
        <ErrorBoundary
          fallback={<Text c="red">Chat interface failed to load</Text>}
        >
          <Suspense fallback={<Text>Loading messages...</Text>}>
            <MessageList
              messages={messages}
              isGenerating={state.isGenerating}
              streamedResponse={state.streamedResponse}
            />
          </Suspense>
          <Suspense fallback={<Text>Loading input area...</Text>}>
            <ChatInputArea
              value={state.input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              handleSend={handleSend}
              isGenerating={state.isGenerating}
            />
          </Suspense>
        </ErrorBoundary>
      </Stack>
    </Card>
  );
}
