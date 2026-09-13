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
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import { persistChatMessages, runFollowUpSearch } from "@/modules/chatHelpers";
import { generateFollowUpQuestion } from "@/modules/followUpQuestions";
import { handleEnterKeyDown } from "@/modules/keyboard";
import { addLogEntry } from "@/modules/logEntries";
import { showAiCompleteNotification } from "@/modules/notifications";
import {
  chatGenerationStatePubSub,
  chatInputPubSub,
  followUpQuestionPubSub,
  getChatGenerationState,
  imageSearchResultsPubSub,
  queryPubSub,
  settingsPubSub,
  suppressNextFollowUpPubSub,
  textSearchResultsPubSub,
} from "@/modules/pubSub";
import { generateChatResponse } from "@/modules/textGeneration";
import type { ChatMessage } from "@/modules/types";
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
  /**
   * Identifies the newest `regenerateFollowUpQuestion` call. A boolean cannot
   * represent two in flight, so a completion whose id is no longer current does
   * nothing: otherwise whichever finished first would clear the flag while the
   * other was still working, dropping the wake lock, and an orphaned call would
   * write the previous answer's question into the input placeholder.
   */
  const followUpInvocationRef = useRef(0);
  /**
   * False once this instance has unmounted. The pubsub setters are module-level
   * publishers, so an orphaned flow keeps writing into whatever is mounted now
   * unless it checks first.
   */
  const isMountedRef = useRef(true);
  const updateStreamedResponse = useCallback(
    throttle((response: string) => {
      setStreamedResponse(response);
    }, 1000 / 12),
    [],
  );

  useScreenWakeLock(
    generationState.isGeneratingResponse ||
      generationState.isGeneratingFollowUpQuestion,
  );

  const regenerateFollowUpQuestion = useCallback(
    async (currentQuery: string, currentResponse: string) => {
      // A send that settles after unmount still runs its closure to the end and
      // calls this. Bumping the dead instance's token would not stop it: it
      // would pass its own check and write into the live mount.
      if (!isMountedRef.current) return;
      if (suppressNextFollowUp) return;
      if (!currentResponse || !currentQuery.trim()) return;

      // After the guards, never before them. A call that returns early never
      // set the flag, so invalidating the in-flight one would make its
      // completion a no-op and leave the flag, and the wake lock, held until
      // unmount.
      const invocation = ++followUpInvocationRef.current;

      try {
        setGenerationState({
          ...getChatGenerationState(),
          isGeneratingFollowUpQuestion: true,
        });

        const newQuestion = await generateFollowUpQuestion({
          topic: currentQuery,
          currentContent: currentResponse,
          previousQuestions: previousFollowUpQuestions,
        });

        // A newer call, or an unmount, took over while this one awaited.
        if (invocation !== followUpInvocationRef.current) return;

        setPreviousFollowUpQuestions((prev) =>
          [...prev, newQuestion].slice(-5),
        );
        setFollowUpQuestion(newQuestion);
        setGenerationState({
          ...getChatGenerationState(),
          isGeneratingFollowUpQuestion: false,
        });
      } catch (_) {
        if (invocation !== followUpInvocationRef.current) return;
        setFollowUpQuestion("");
        setGenerationState({
          ...getChatGenerationState(),
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
    // Set on every run, not just the first: under StrictMode the cleanup fires
    // once before the effect runs again, and a ref left false would kill the
    // remounted instance.
    isMountedRef.current = true;

    return () => {
      // Invalidate any in-flight call so its completion cannot write into the
      // next mount, then clear the generation flags the same way the question
      // is cleared: an orphaned flow's `finally` would otherwise resurrect them
      // there, and nothing else resets this channel on unmount.
      isMountedRef.current = false;
      followUpInvocationRef.current += 1;
      setFollowUpQuestion("");
      setPreviousFollowUpQuestions([]);
      setGenerationState({
        isGeneratingResponse: false,
        isGeneratingFollowUpQuestion: false,
      });
    };
  }, [setFollowUpQuestion, setGenerationState]);

  const handleEditMessage = useCallback(
    (absoluteIndex: number) => {
      const target = messages[absoluteIndex];
      if (target?.role !== "user") return;
      setInput(target.content);
      setMessages(messages.slice(0, absoluteIndex));
      setFollowUpQuestion("");
    },
    [messages, setInput, setFollowUpQuestion],
  );

  const handleRegenerateResponse = useCallback(async () => {
    if (
      getChatGenerationState().isGeneratingResponse ||
      messages.length < 3 ||
      messages[messages.length - 1].role !== "assistant"
    )
      return;

    const history = messages.slice(0, -1);
    const lastUser = history[history.length - 1];

    setMessages(history);
    setGenerationState({
      ...getChatGenerationState(),
      isGeneratingResponse: true,
    });
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
        if (settings.enableNotificationOnAiComplete) {
          showAiCompleteNotification(lastUser.content);
        }
        // Not awaited: the follow-up question raises its own flag
        // synchronously, so the `finally` below can hand the wake lock over
        // and release the response flag while that question is still coming.
        regenerateFollowUpQuestion(lastUser.content, finalResponse);
      }
    } catch (error) {
      addLogEntry(`Error re-generating response: ${error}`);
    } finally {
      if (isMountedRef.current) {
        setGenerationState({
          ...getChatGenerationState(),
          isGeneratingResponse: false,
        });
      }
    }
  }, [
    messages,
    regenerateFollowUpQuestion,
    settings,
    setFollowUpQuestion,
    setGenerationState,
    updateStreamedResponse,
  ]);

  const handleSend = useCallback(
    async (textToSend?: string) => {
      const currentInput = textToSend ?? input;
      if (
        currentInput.trim() === "" ||
        getChatGenerationState().isGeneratingResponse
      ) {
        return;
      }

      const userMessage: ChatMessage = { role: "user", content: currentInput };
      const newMessages: ChatMessage[] = [...messages, userMessage];

      setMessages(newMessages);
      if (!textToSend) setInput("");
      setGenerationState({
        ...getChatGenerationState(),
        isGeneratingResponse: true,
      });
      setFollowUpQuestion("");
      setStreamedResponse("");

      try {
        await runFollowUpSearch(
          newMessages,
          currentInput,
          settings,
          textSearchResults,
          imageSearchResults,
        );
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

        if (settings.enableNotificationOnAiComplete) {
          showAiCompleteNotification(currentInput);
        }

        await persistChatMessages(currentQuery, currentInput, finalResponse);

        regenerateFollowUpQuestion(currentInput, finalResponse);
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
        if (isMountedRef.current) {
          setGenerationState({
            ...getChatGenerationState(),
            isGeneratingResponse: false,
          });
        }
      }
    },
    [
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
