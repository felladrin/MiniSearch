import { Card, Stack, Text } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import {
  type KeyboardEvent,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ErrorBoundary } from "react-error-boundary";
import { generateFollowUpQuestion } from "../../modules/followUpQuestions";
import { handleEnterKeyDown } from "../../modules/keyboard";
import { addLogEntry } from "../../modules/logEntries";
import {
  chatGenerationStatePubSub,
  chatInputPubSub,
  followUpQuestionPubSub,
  getImageSearchResults,
  getTextSearchResults,
  settingsPubSub,
  updateImageSearchResults,
  updateLlmTextSearchResults,
  updateTextSearchResults,
} from "../../modules/pubSub";
import { generateRelatedSearchQuery } from "../../modules/relatedSearchQuery";
import { searchImages, searchText } from "../../modules/search";
import { generateChatResponse } from "../../modules/textGeneration";

const ChatHeader = lazy(() => import("./ChatHeader"));
const MessageList = lazy(() => import("./MessageList"));
const ChatInputArea = lazy(() => import("./ChatInputArea"));

export interface ChatInterfaceProps {
  initialQuery?: string;
  initialResponse?: string;
}

export default function ChatInterface({
  initialQuery,
  initialResponse,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = usePubSub(chatInputPubSub);
  const [generationState, setGenerationState] = usePubSub(
    chatGenerationStatePubSub,
  );
  const [, setFollowUpQuestion] = usePubSub(followUpQuestionPubSub);
  const [settings] = usePubSub(settingsPubSub);
  const [streamedResponse, setStreamedResponse] = useState("");

  const regenerateFollowUpQuestion = useCallback(
    async (currentQuery: string, currentResponse: string) => {
      if (!currentResponse || !currentQuery.trim()) return;

      try {
        setGenerationState({
          isGeneratingResponse: false,
          isGeneratingFollowUpQuestion: true,
        });

        const newQuestion = await generateFollowUpQuestion({
          topic: currentQuery,
          currentContent: currentResponse,
        });

        setFollowUpQuestion(newQuestion);
        setGenerationState({
          isGeneratingResponse: false,
          isGeneratingFollowUpQuestion: false,
        });
      } catch (error) {
        setFollowUpQuestion("");
        setGenerationState({
          isGeneratingResponse: false,
          isGeneratingFollowUpQuestion: false,
        });
      }
    },
    [setFollowUpQuestion, setGenerationState],
  );

  useEffect(() => {
    if (messages.length === 0 && initialQuery && initialResponse) {
      setMessages([
        { role: "user", content: initialQuery },
        { role: "assistant", content: initialResponse },
      ]);
      regenerateFollowUpQuestion(initialQuery, initialResponse);
    }
  }, [
    initialQuery,
    initialResponse,
    messages.length,
    regenerateFollowUpQuestion,
  ]);

  const handleSend = async (textToSend?: string) => {
    const currentInput = textToSend ?? input;
    if (currentInput.trim() === "" || generationState.isGeneratingResponse)
      return;

    const userMessage: ChatMessage = { role: "user", content: currentInput };
    const newMessages: ChatMessage[] = [...messages, userMessage];

    setMessages(newMessages);
    setInput(textToSend ? input : "");
    setGenerationState({
      ...generationState,
      isGeneratingResponse: true,
    });
    setFollowUpQuestion("");
    setStreamedResponse("");

    try {
      const relatedQuery = await generateRelatedSearchQuery([...newMessages]);
      const searchQuery = relatedQuery || currentInput;

      if (settings.enableTextSearch) {
        const freshResults = await searchText(
          searchQuery,
          settings.searchResultsLimit,
        );

        if (freshResults.length > 0) {
          const existingUrls = new Set(
            getTextSearchResults().map(([, , url]) => url),
          );

          const uniqueFreshResults = freshResults.filter(
            ([, , url]) => !existingUrls.has(url),
          );

          if (uniqueFreshResults.length > 0) {
            updateTextSearchResults([
              ...getTextSearchResults(),
              ...uniqueFreshResults,
            ]);
            updateLlmTextSearchResults(
              uniqueFreshResults.slice(0, settings.searchResultsToConsider),
            );
          }
        }
      }

      if (settings.enableImageSearch) {
        searchImages(searchQuery, settings.searchResultsLimit)
          .then((imageResults) => {
            if (imageResults.length > 0) {
              const existingUrls = new Set(
                getImageSearchResults().map(([, , url]) => url),
              );

              const uniqueFreshResults = imageResults.filter(
                ([, , url]) => !existingUrls.has(url),
              );

              if (uniqueFreshResults.length > 0) {
                updateImageSearchResults([
                  ...uniqueFreshResults,
                  ...getImageSearchResults(),
                ]);
              }
            }
          })
          .catch((error) => {
            addLogEntry(`Error in follow-up image search: ${error}`);
          });
      }
    } catch (error) {
      addLogEntry(`Error in follow-up search: ${error}`);
    }

    try {
      const finalResponse = await generateChatResponse(
        newMessages,
        (partialResponse) => {
          setStreamedResponse(partialResponse);
        },
      );

      setMessages((prevMessages) => [
        ...prevMessages,
        { role: "assistant", content: finalResponse },
      ]);

      addLogEntry("AI response completed");

      await regenerateFollowUpQuestion(currentInput, finalResponse);
    } catch (error) {
      addLogEntry(`Error in chat response: ${error}`);
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          role: "assistant",
          content: "Sorry, I encountered an error while generating a response.",
        },
      ]);
    } finally {
      setGenerationState({
        ...generationState,
        isGeneratingResponse: false,
      });
    }
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
              messages={
                generationState.isGeneratingResponse
                  ? [
                      ...messages,
                      { role: "assistant", content: streamedResponse },
                    ]
                  : messages
              }
            />
          </Suspense>
          <Suspense fallback={<Text>Loading input area...</Text>}>
            <ChatInputArea onKeyDown={handleKeyDown} handleSend={handleSend} />
          </Suspense>
        </ErrorBoundary>
      </Stack>
    </Card>
  );
}
