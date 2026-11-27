import { MantineProvider } from "@mantine/core";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatGenerationStatePubSub,
  chatMessagesPubSub,
  followUpQuestionPubSub,
  getChatSession,
  getSettings,
  queryPubSub,
  responsePubSub,
  settingsPubSub,
  updateChatSession,
  updateIsRestoringFromHistory,
  updateSuppressNextFollowUp,
  updateTextGenerationState,
} from "@/modules/pubSub";
import type { ChatMessage } from "@/modules/types";
import AiResponseSection from "./AiResponseSection";

const [updateChatGenerationState, , getChatGenerationState] =
  chatGenerationStatePubSub;
const [updateChatMessages] = chatMessagesPubSub;
const [updateFollowUpQuestion, , getFollowUpQuestion] = followUpQuestionPubSub;
const [updateQuery] = queryPubSub;
const [updateResponse] = responsePubSub;
const [updateSettings] = settingsPubSub;

vi.mock("@mantine/code-highlight", () => ({
  CodeHighlightAdapterProvider: ({ children }: { children: ReactNode }) =>
    children,
}));
vi.mock("@mantine/code-highlight/styles.css", () => ({}));
vi.mock("@/modules/shiki", () => ({ shikiAdapter: {} }));
vi.mock("@/hooks/useScreenWakeLock", () => ({ useScreenWakeLock: vi.fn() }));

vi.mock("@/modules/textGeneration", () => ({
  generateChatResponse: vi.fn(),
}));

vi.mock("@/modules/followUpQuestions", () => ({
  generateFollowUpQuestion: vi.fn(),
}));

vi.mock("@/modules/chatHelpers", () => ({
  persistChatConversation: vi.fn(() => Promise.resolve()),
  runFollowUpSearch: vi.fn(() => Promise.resolve()),
}));

/** The search on screen; a test changes it to restore another search. */
let currentSearchRunId = "run-1";
vi.mock("@/modules/history", () => ({
  getCurrentSearchRunId: vi.fn(() => currentSearchRunId),
}));

vi.mock("@/modules/notifications", () => ({
  showAiCompleteNotification: vi.fn(),
}));

vi.mock("@/modules/logEntries", () => ({ addLogEntry: vi.fn() }));

vi.mock("./AiResponseContent", () => ({ default: () => null }));
vi.mock("./ChatHeader", () => ({ default: () => null }));

let sendMessage: (textToSend?: string) => Promise<void>;
let messageListMessages: ChatMessage[] = [];

vi.mock("./ChatInputArea", () => ({
  default: (props: { handleSend: (textToSend?: string) => Promise<void> }) => {
    sendMessage = props.handleSend;
    return null;
  },
}));

vi.mock("./MessageList", () => ({
  default: (props: { messages: ChatMessage[] }) => {
    messageListMessages = props.messages;
    return null;
  },
}));

const { generateChatResponse } = await import("@/modules/textGeneration");
const { generateFollowUpQuestion } = await import(
  "@/modules/followUpQuestions"
);
const { persistChatConversation } = await import("@/modules/chatHelpers");

/**
 * Switches the chat to another search the way a restore of a search with a
 * saved answer does: a new run id and chat session, with the flags that keep
 * the remounted chat from asking for a question of its own.
 */
async function restoreAnotherSearch(searchRunId: string) {
  updateIsRestoringFromHistory(true);
  updateSuppressNextFollowUp(true);
  currentSearchRunId = searchRunId;
  updateChatSession(getChatSession() + 1);
  await Promise.resolve();
  updateIsRestoringFromHistory(false);
}

beforeEach(() => {
  currentSearchRunId = "run-1";
  messageListMessages = [];
  updateSettings({ ...getSettings(), enableAiResponse: true });
  updateQuery("Search A");
  updateResponse("Answer A");
  updateChatMessages([]);
  updateFollowUpQuestion("");
  updateChatGenerationState({
    isGeneratingResponse: false,
    isGeneratingFollowUpQuestion: false,
  });
  updateTextGenerationState("completed");
  // Mounted as a restored answer, so the chat does not suggest a question
  // for the first answer.
  updateIsRestoringFromHistory(true);
  updateSuppressNextFollowUp(true);
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("AiResponseSection", () => {
  it("aborts a follow-up when another search is restored", async () => {
    let followUpSignal: AbortSignal | undefined;
    vi.mocked(generateChatResponse).mockImplementationOnce(
      (_messages, _onUpdate, signal) => {
        followUpSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new Error("Chat generation interrupted")),
          );
        });
      },
    );
    vi.mocked(generateFollowUpQuestion).mockResolvedValue("Old question?");

    render(
      <MantineProvider>
        <AiResponseSection />
      </MantineProvider>,
    );
    act(() => updateIsRestoringFromHistory(false));

    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = sendMessage("A follow-up about A");
    });
    expect(getChatGenerationState().isGeneratingResponse).toBe(true);

    await act(async () => {
      await restoreAnotherSearch("run-2");
      await send;
    });

    expect(followUpSignal?.aborted).toBe(true);
    expect(getChatGenerationState().isGeneratingResponse).toBe(false);
    expect(
      messageListMessages.some(
        (message) => message.content === "A follow-up about A",
      ),
    ).toBe(false);
    expect(persistChatConversation).toHaveBeenCalledWith("run-1", [
      { role: "user", content: "A follow-up about A" },
      { role: "assistant", content: "The answer was interrupted." },
    ]);
    expect(persistChatConversation).not.toHaveBeenCalledWith(
      "run-2",
      expect.anything(),
    );
    expect(generateFollowUpQuestion).not.toHaveBeenCalled();
    expect(getFollowUpQuestion()).toBe("");

    vi.mocked(generateChatResponse).mockResolvedValueOnce("Answer about B");
    await act(async () => {
      await sendMessage("A follow-up about B");
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
    expect(persistChatConversation).toHaveBeenLastCalledWith("run-2", [
      { role: "user", content: "A follow-up about B" },
      { role: "assistant", content: "Answer about B" },
    ]);
  });
});
