import { Card, Stack } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import throttle from "throttleit";
import { generateFollowUpQuestion } from "../../modules/followUpQuestions";
import {
  getCurrentSearchRunId,
  saveChatMessageForQuery,
  updateSearchResults,
} from "../../modules/history";
import { handleEnterKeyDown } from "../../modules/keyboard";
import { addLogEntry } from "../../modules/logEntries";
import {
  chatGenerationStatePubSub,
  chatInputPubSub,
  followUpQuestionPubSub,
  imageSearchResultsPubSub,
  queryPubSub,
  settingsPubSub,
  suppressNextFollowUpPubSub,
  textSearchResultsPubSub,
  updateImageSearchResults,
  updateTextSearchResults,
} from "../../modules/pubSub";
import { generateRelatedSearchQuery } from "../../modules/relatedSearchQuery";
import { searchImages, searchText } from "../../modules/search";
import { generateChatResponse } from "../../modules/textGeneration";
import type { ChatMessage } from "../../modules/types";
import ChatHeader from "./ChatHeader";
import ChatInputArea from "./ChatInputArea";
import MessageList from "./MessageList";

interface ChatInterfaceProps {
  initialQuery?: string;
  initialResponse?: string;
  initialMessages?: ChatMessage[];
  suppressInitialFollowUp?: boolean;
}

export default function ChatInterface({
  initialQuery,
  initialResponse,
  initialMessages,
  suppressInitialFollowUp,
}: ChatInterfaceProps) {
  const initialMessagesArray =
    initialMessages &&
    initialMessages.length > 0 &&
    initialQuery &&
    initialResponse
      ? [
          { role: "user" as const, content: initialQuery },
          { role: "assistant" as const, content: initialResponse },
          ...initialMessages,
        ]
      : initialMessages || [];

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessagesArray);
  const [input, setInput] = usePubSub(chatInputPubSub);
  const [generationState, setGenerationState] = usePubSub(
    chatGenerationStatePubSub,
  );
  const [, setFollowUpQuestion] = usePubSub(followUpQuestionPubSub);
  const [textSearchResults] = usePubSub(textSearchResultsPubSub);
  const [imageSearchResults] = usePubSub(imageSearchResultsPubSub);
  const [currentQuery] = usePubSub(queryPubSub);
  const [suppressNextFollowUp] = usePubSub(suppressNextFollowUpPubSub);
  const [previousFollowUpQuestions, setPreviousFollowUpQuestions] = useState<
    string[]
  >([]);
  const [settings] = usePubSub(settingsPubSub);
  const [streamedResponse, setStreamedResponse] = useState("");
  const hasInitialized = useRef(false);
  const prevInitialMessagesRef = useRef<ChatMessage[] | undefined>(undefined);
  const updateStreamedResponse = useCallback(
    throttle((response: string) => {
      setStreamedResponse(response);
    }, 1000 / 12),
    [],
  );

  const regenerateFollowUpQuestion = useCallback(
    async (currentQuery: string, currentResponse: string) => {
      if (suppressNextFollowUp) return;
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
    [
      setFollowUpQuestion,
      setGenerationState,
      previousFollowUpQuestions,
      suppressNextFollowUp,
    ],
  );

  useEffect(() => {
    const messagesChanged =
      !prevInitialMessagesRef.current ||
      JSON.stringify(prevInitialMessagesRef.current) !==
        JSON.stringify(initialMessages);

    if (!messagesChanged) return;

    prevInitialMessagesRef.current = initialMessages;

    const newInitialMessagesArray =
      initialMessages &&
      initialMessages.length > 0 &&
      initialQuery &&
      initialResponse
        ? [
            { role: "user" as const, content: initialQuery },
            { role: "assistant" as const, content: initialResponse },
            ...initialMessages,
          ]
        : initialMessages || [];

    if (newInitialMessagesArray.length > 0) {
      setMessages(newInitialMessagesArray);
    } else if (initialQuery && initialResponse) {
      setMessages([
        { role: "user", content: initialQuery },
        { role: "assistant", content: initialResponse },
      ]);
    }
  }, [initialQuery, initialResponse, initialMessages]);

  useEffect(() => {
    if (suppressNextFollowUp) {
      hasInitialized.current = true;
      return;
    }
    if (suppressInitialFollowUp) return;
    if (hasInitialized.current) return;

    if (initialMessages && initialMessages.length > 0) {
      const lastAssistant = messages
        .filter((m) => m.role === "assistant")
        .pop();
      const lastUser = messages.filter((m) => m.role === "user").pop();
      if (lastUser && lastAssistant) {
        regenerateFollowUpQuestion(lastUser.content, lastAssistant.content);
        hasInitialized.current = true;
      }
    } else if (messages.length >= 2 && initialQuery && initialResponse) {
      regenerateFollowUpQuestion(initialQuery, initialResponse);
      hasInitialized.current = true;
    }
  }, [
    initialQuery,
    initialResponse,
    initialMessages,
    messages,
    regenerateFollowUpQuestion,
    suppressInitialFollowUp,
    suppressNextFollowUp,
  ]);

  useEffect(() => {
    return () => {
      setFollowUpQuestion("");
      setPreviousFollowUpQuestions([]);
    };
  }, [setFollowUpQuestion]);

  const handleEditMessage = useCallback(
    (absoluteIndex: number) => {
      const target = messages[absoluteIndex];
      if (!target || target.role !== "user") return;
      setInput(target.content);
      setMessages(messages.slice(0, absoluteIndex));
      setFollowUpQuestion("");
    },
    [messages, setInput, setFollowUpQuestion],
  );

  const handleRegenerateResponse = useCallback(async () => {
    if (
      generationState.isGeneratingResponse ||
      messages.length < 3 ||
      messages[messages.length - 1].role !== "assistant"
    )
      return;

    const history = messages.slice(0, -1);
    const lastUser = history[history.length - 1];

    setMessages(history);
    setGenerationState({ ...generationState, isGeneratingResponse: true });
    setFollowUpQuestion("");
    setStreamedResponse("");

    try {
      const finalResponse = await generateChatResponse(
        history,
        updateStreamedResponse,
      );

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: finalResponse },
      ]);

      addLogEntry("AI response re-generated");

      if (lastUser?.role === "user") {
        await regenerateFollowUpQuestion(lastUser.content, finalResponse);
      }
    } catch (error) {
      addLogEntry(`Error re-generating response: ${error}`);
    } finally {
      setGenerationState({ ...generationState, isGeneratingResponse: false });
    }
  }, [
    generationState,
    messages,
    regenerateFollowUpQuestion,
    setFollowUpQuestion,
    setGenerationState,
    updateStreamedResponse,
  ]);

  const handleSend = useCallback(
    async (textToSend?: string) => {
      const currentInput = textToSend ?? input;
      if (currentInput.trim() === "" || generationState.isGeneratingResponse)
        return;

      const userMessage: ChatMessage = { role: "user", content: currentInput };
      const newMessages: ChatMessage[] = [...messages, userMessage];

      setMessages(newMessages);
      if (!textToSend) setInput("");
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
              textSearchResults.map(([, , url]) => url),
            );

            const uniqueFreshResults = freshResults.filter(
              ([, , url]) => !existingUrls.has(url),
            );

            if (uniqueFreshResults.length > 0) {
              const updatedResults = [
                ...textSearchResults,
                ...uniqueFreshResults,
              ];
              updateTextSearchResults(updatedResults);

              updateSearchResults(getCurrentSearchRunId(), {
                textResults: {
                  type: "text",
                  items: updatedResults.map(([title, snippet, url]) => ({
                    title,
                    url,
                    snippet,
                  })),
                },
              });
            }
          }
        }

        if (settings.enableImageSearch) {
          searchImages(searchQuery, settings.searchResultsLimit)
            .then((imageResults) => {
              if (imageResults.length > 0) {
                const existingUrls = new Set(
                  imageSearchResults.map(([, url]) => url),
                );

                const uniqueFreshResults = imageResults.filter(
                  ([, url]) => !existingUrls.has(url),
                );

                if (uniqueFreshResults.length > 0) {
                  const updatedImageResults = [
                    ...uniqueFreshResults,
                    ...imageSearchResults,
                  ];
                  updateImageSearchResults(updatedImageResults);

                  updateSearchResults(getCurrentSearchRunId(), {
                    imageResults: {
                      type: "image",
                      items: updatedImageResults.map(
                        ([title, url, thumbnailUrl, sourceUrl]) => ({
                          title,
                          url,
                          thumbnailUrl,
                          sourceUrl,
                        }),
                      ),
                    },
                  });
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

        await saveChatMessageForQuery(currentQuery, "user", currentInput);
        await saveChatMessageForQuery(currentQuery, "assistant", finalResponse);

        await regenerateFollowUpQuestion(currentInput, finalResponse);
      } catch (error) {
        addLogEntry(`Error in chat response: ${error}`);
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            role: "assistant",
            content:
              "Sorry, I encountered an error while generating a response.",
          },
        ]);
      } finally {
        setGenerationState({
          ...generationState,
          isGeneratingResponse: false,
        });
      }
    },
    [
      generationState,
      messages,
      settings,
      input,
      regenerateFollowUpQuestion,
      setFollowUpQuestion,
      setGenerationState,
      setInput,
      updateStreamedResponse,
      currentQuery,
      textSearchResults,
      imageSearchResults,
    ],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      handleEnterKeyDown(event, settings, handleSend);
    },
    [settings, handleSend],
  );

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
          onEditMessage={handleEditMessage}
          onRegenerate={handleRegenerateResponse}
          isGenerating={generationState.isGeneratingResponse}
        />
        <ChatInputArea onKeyDown={handleKeyDown} handleSend={handleSend} />
      </Stack>
    </Card>
  );
}
