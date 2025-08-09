import { Card, Stack } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
import throttle from "throttleit";
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
import ChatHeader from "./ChatHeader";
import ChatInputArea from "./ChatInputArea";
import MessageList from "./MessageList";

interface ChatInterfaceProps {
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
  const [previousFollowUpQuestions, setPreviousFollowUpQuestions] = useState<
    string[]
  >([]);
  const [settings] = usePubSub(settingsPubSub);
  const [streamedResponse, setStreamedResponse] = useState("");
  const updateStreamedResponse = useCallback(
    throttle((response: string) => {
      setStreamedResponse(response);
    }, 1000 / 12),
    [],
  );

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
          previousQuestions: previousFollowUpQuestions,
        });

        setPreviousFollowUpQuestions((prev) =>
          [...prev, newQuestion].slice(-5),
        );
        setFollowUpQuestion(newQuestion);
        setGenerationState({
          isGeneratingResponse: false,
          isGeneratingFollowUpQuestion: false,
        });
      } catch (_) {
        setFollowUpQuestion("");
        setGenerationState({
          isGeneratingResponse: false,
          isGeneratingFollowUpQuestion: false,
        });
      }
    },
    [setFollowUpQuestion, setGenerationState, previousFollowUpQuestions],
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

    if (messages.length === 0) {
      setPreviousFollowUpQuestions([]);
    }

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
                getImageSearchResults().map(([, url]) => url),
              );

              const uniqueFreshResults = imageResults.filter(
                ([, url]) => !existingUrls.has(url),
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
        updateStreamedResponse,
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
        <ChatHeader messages={messages} />
      </Card.Section>
      <Stack gap="md" pt="md">
        <MessageList
          messages={
            generationState.isGeneratingResponse
              ? [...messages, { role: "assistant", content: streamedResponse }]
              : messages
          }
        />
        <ChatInputArea onKeyDown={handleKeyDown} handleSend={handleSend} />
      </Stack>
    </Card>
  );
}
