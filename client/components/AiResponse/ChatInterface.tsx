import { Card, Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
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
  getFollowUpQuestion,
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

/**
 * The messages the chat starts from, and where its follow-ups begin. The main
 * question and answer lead the list only when the answer has text: after an
 * empty main answer the follow-ups start at 0, so the first follow-up pair is
 * not mistaken for them.
 */
function buildInitialConversation(
  initialQuery: string | undefined,
  initialResponse: string | undefined,
  initialMessages: ChatMessage[] = [],
): { messages: ChatMessage[]; followUpStartIndex: number } {
  if (initialQuery && initialResponse) {
    return {
      messages: [
        { role: "user", content: initialQuery },
        { role: "assistant", content: initialResponse },
        ...initialMessages,
      ],
      followUpStartIndex: 2,
    };
  }
  return { messages: initialMessages, followUpStartIndex: 0 };
}

export default function ChatInterface({
  initialQuery,
  initialResponse,
  initialMessages,
  suppressInitialFollowUp,
}: ChatInterfaceProps) {
  const [initialConversation] = useState(() =>
    buildInitialConversation(initialQuery, initialResponse, initialMessages),
  );
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialConversation.messages,
  );
  const [followUpStartIndex, setFollowUpStartIndex] = useState(
    initialConversation.followUpStartIndex,
  );
  const [input, setInput] = usePubSub(chatInputPubSub);
  const [generationState, setGenerationState] = usePubSub(
    chatGenerationStatePubSub,
  );
  const [, setFollowUpQuestion] = usePubSub(followUpQuestionPubSub);
  const [textSearchResults] = usePubSub(textSearchResultsPubSub);
  const [imageSearchResults] = usePubSub(imageSearchResultsPubSub);
  const [currentQuery] = usePubSub(queryPubSub);
  const [suppressNextFollowUp, setSuppressNextFollowUp] = usePubSub(
    suppressNextFollowUpPubSub,
  );
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
  /** One per chat send or regenerate still running, aborted on unmount. */
  const chatControllersRef = useRef(new Set<AbortController>());
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

        // No question was found in the reply: an empty entry would show up as
        // a blank line in the next prompt's "do not repeat" list and push a
        // real question out of it.
        if (newQuestion) {
          setPreviousFollowUpQuestions((prev) =>
            [...prev, newQuestion].slice(-5),
          );
        }
        setFollowUpQuestion(newQuestion);
        setGenerationState({
          ...getChatGenerationState(),
          isGeneratingFollowUpQuestion: false,
        });
      } catch (error) {
        if (invocation !== followUpInvocationRef.current) return;
        addLogEntry(`Error generating follow-up question: ${error}`);
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

    const conversation = buildInitialConversation(
      initialQuery,
      initialResponse,
      initialMessages,
    );
    if (conversation.messages.length > 0) {
      setMessages(conversation.messages);
      setFollowUpStartIndex(conversation.followUpStartIndex);
    }
  }, [initialQuery, initialResponse, initialMessages]);

  useEffect(() => {
    if (suppressNextFollowUp) {
      hasInitialized.current = true;
      followUpInvocationRef.current += 1;
      setFollowUpQuestion("");
      setGenerationState({
        ...getChatGenerationState(),
        isGeneratingFollowUpQuestion: false,
      });
      setSuppressNextFollowUp(false);
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
    setFollowUpQuestion,
    setGenerationState,
    setSuppressNextFollowUp,
    suppressInitialFollowUp,
    suppressNextFollowUp,
  ]);

  useEffect(() => {
    // Re-armed rather than left to the initial value, so a future re-run of
    // this effect cannot leave the instance marked dead. It does not make the
    // component StrictMode-safe: there the cleanup's token bump would orphan
    // the mount effect's call while `hasInitialized` stays true, and the first
    // answer would get no follow-up question at all.
    isMountedRef.current = true;

    return () => {
      // Invalidate any in-flight call so its completion cannot write into the
      // next mount, then clear the generation flags the same way the question
      // is cleared: an orphaned flow's `finally` would otherwise resurrect them
      // there, and nothing else resets this channel on unmount.
      isMountedRef.current = false;
      for (const controller of chatControllersRef.current) controller.abort();
      chatControllersRef.current.clear();
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
      // There must be a follow-up question before the answer to regenerate.
      messages.length - 1 <= followUpStartIndex ||
      messages[messages.length - 1].role !== "assistant"
    )
      return;

    const history = messages.slice(0, -1);
    const lastUser = history[history.length - 1];
    // Streaming needs the old answer off the list, so keep it and the
    // follow-up that was showing to put back if the regeneration fails.
    const previousAnswer = messages[messages.length - 1];
    const previousFollowUpQuestion = getFollowUpQuestion();

    setMessages(history);
    setGenerationState({
      ...getChatGenerationState(),
      isGeneratingResponse: true,
    });
    setFollowUpQuestion("");
    setStreamedResponse("");

    const controller = new AbortController();
    chatControllersRef.current.add(controller);

    try {
      const finalResponse = await generateChatResponse(
        history,
        updateStreamedResponse,
        controller.signal,
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
      if (isMountedRef.current) {
        setStreamedResponse("");
        setMessages((prev) => [...prev, previousAnswer]);
        setFollowUpQuestion(previousFollowUpQuestion);
        notifications.show({
          message:
            "Couldn't re-generate the response. The previous answer has been kept.",
          color: "red",
        });
      }
    } finally {
      chatControllersRef.current.delete(controller);
      if (isMountedRef.current) {
        setGenerationState({
          ...getChatGenerationState(),
          isGeneratingResponse: false,
        });
      }
    }
  }, [
    followUpStartIndex,
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

      const controller = new AbortController();
      chatControllersRef.current.add(controller);

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
          controller.signal,
        );

        setMessages((prevMessages) => [
          ...prevMessages,
          { role: "assistant", content: finalResponse },
        ]);

        addLogEntry("AI response completed");

        if (settings.enableNotificationOnAiComplete) {
          showAiCompleteNotification(currentInput);
        }

        try {
          await persistChatMessages(currentQuery, currentInput, finalResponse);
        } catch (error) {
          addLogEntry(`Error persisting chat messages: ${error}`);
        }

        regenerateFollowUpQuestion(currentInput, finalResponse);
      } catch (error) {
        addLogEntry(`Error in chat response: ${error}`);
        if (controller.signal.aborted) return;
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            role: "assistant",
            content:
              "Sorry, I encountered an error while generating a response.",
          },
        ]);
      } finally {
        chatControllersRef.current.delete(controller);
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
        <ChatHeader
          messages={messages}
          followUpStartIndex={followUpStartIndex}
        />
      </Card.Section>
      <Stack gap="md" pt="md">
        <MessageList
          messages={
            generationState.isGeneratingResponse
              ? [...messages, { role: "assistant", content: streamedResponse }]
              : messages
          }
          followUpStartIndex={followUpStartIndex}
          onEditMessage={handleEditMessage}
          onRegenerate={handleRegenerateResponse}
          isGenerating={generationState.isGeneratingResponse}
        />
        <ChatInputArea onKeyDown={handleKeyDown} handleSend={handleSend} />
      </Stack>
    </Card>
  );
}
