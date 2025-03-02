import {
  Button,
  Card,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
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
import { handleEnterKeyDown } from "../../modules/keyboard";
import { addLogEntry } from "../../modules/logEntries";
import { settingsPubSub } from "../../modules/pubSub";
import { generateChatResponse } from "../../modules/textGeneration";

const FormattedMarkdown = lazy(() => import("./FormattedMarkdown"));
const CopyIconButton = lazy(() => import("./CopyIconButton"));

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
    <Card withBorder shadow="sm" radius="md">
      <Card.Section withBorder inheritPadding py="xs">
        <Group justify="space-between">
          <Text fw={500}>Follow-up questions</Text>
          {messages.length > 2 && (
            <Suspense>
              <CopyIconButton
                value={getChatContent()}
                tooltipLabel="Copy conversation"
              />
            </Suspense>
          )}
        </Group>
      </Card.Section>
      <Stack gap="md" pt="md">
        {messages.slice(2).length > 0 && (
          <Stack gap="md">
            {messages.slice(2).map((message, index) => (
              <Paper
                key={`${message.role}-${index}`}
                shadow="xs"
                radius="xl"
                p="sm"
                maw="90%"
                style={{
                  alignSelf:
                    message.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <Suspense>
                  <FormattedMarkdown>{message.content}</FormattedMarkdown>
                </Suspense>
              </Paper>
            ))}
            {state.isGenerating && state.streamedResponse.length > 0 && (
              <Paper
                shadow="xs"
                radius="xl"
                p="sm"
                maw="90%"
                style={{ alignSelf: "flex-start" }}
              >
                <Suspense>
                  <FormattedMarkdown>
                    {state.streamedResponse}
                  </FormattedMarkdown>
                </Suspense>
              </Paper>
            )}
          </Stack>
        )}
        <Group align="flex-end" style={{ position: "relative" }}>
          <Textarea
            placeholder="Anything else you would like to know?"
            value={state.input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            autosize
            minRows={1}
            maxRows={4}
            style={{ flexGrow: 1, paddingRight: "50px" }}
            disabled={state.isGenerating}
          />
          <Button
            size="sm"
            variant="default"
            onClick={handleSend}
            loading={state.isGenerating}
            style={{
              height: "100%",
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
            }}
          >
            <IconSend size={16} />
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
