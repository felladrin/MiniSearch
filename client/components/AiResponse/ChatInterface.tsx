import {
  useState,
  useEffect,
  lazy,
  Suspense,
  useRef,
  KeyboardEvent,
} from "react";
import {
  Card,
  Text,
  Textarea,
  Button,
  Stack,
  Group,
  Paper,
} from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { generateChatResponse } from "../../modules/textGeneration";
import { addLogEntry } from "../../modules/logEntries";
import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../../modules/pubSub";
import { match } from "ts-pattern";
import { ChatMessage } from "gpt-tokenizer/GptEncoding";

const FormattedMarkdown = lazy(() => import("./FormattedMarkdown"));

export default function ChatInterface({
  initialQuery,
  initialResponse,
}: {
  initialQuery: string;
  initialResponse: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedResponse, setStreamedResponse] = useState("");
  const latestResponseRef = useRef("");
  const [settings] = usePubSub(settingsPubSub);

  useEffect(() => {
    setMessages([
      { role: "user", content: initialQuery },
      { role: "assistant", content: initialResponse },
    ]);
  }, [initialQuery, initialResponse]);

  const handleSend = async () => {
    if (input.trim() === "" || isGenerating) return;

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: input },
    ];
    setMessages(newMessages);
    setInput("");
    setIsGenerating(true);
    setStreamedResponse("");
    latestResponseRef.current = "";

    try {
      addLogEntry("User sent a follow-up question");
      await generateChatResponse(newMessages, (partialResponse) => {
        setStreamedResponse(partialResponse);
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
      setIsGenerating(false);
      setStreamedResponse("");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    match([event, settings.enterToSubmit])
      .with([{ code: "Enter", shiftKey: false }, true], () => {
        event.preventDefault();
        handleSend();
      })
      .with([{ code: "Enter", shiftKey: true }, false], () => {
        event.preventDefault();
        handleSend();
      })
      .otherwise(() => undefined);
  };

  return (
    <Card withBorder shadow="sm" radius="md">
      <Card.Section withBorder inheritPadding py="xs">
        <Text fw={500}>Follow-up questions</Text>
      </Card.Section>
      <Stack gap="md" pt="md">
        {messages.slice(2).length > 0 && (
          <Stack gap="md">
            {messages.slice(2).map((message, index) => (
              <Paper
                key={index}
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
            {isGenerating && streamedResponse.length > 0 && (
              <Paper
                shadow="xs"
                radius="xl"
                p="sm"
                maw="90%"
                style={{ alignSelf: "flex-start" }}
              >
                <Suspense>
                  <FormattedMarkdown>{streamedResponse}</FormattedMarkdown>
                </Suspense>
              </Paper>
            )}
          </Stack>
        )}
        <Group align="flex-end" style={{ position: "relative" }}>
          <Textarea
            placeholder="Anything else you would like to know?"
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            autosize
            minRows={1}
            maxRows={4}
            style={{ flexGrow: 1, paddingRight: "50px" }}
            disabled={isGenerating}
          />
          <Button
            size="sm"
            variant="default"
            onClick={handleSend}
            loading={isGenerating}
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
