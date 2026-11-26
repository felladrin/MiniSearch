import { MantineProvider } from "@mantine/core";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatGenerationStatePubSub,
  chatInputPubSub,
  chatMessagesPubSub,
  followUpQuestionPubSub,
  getSuppressNextFollowUp,
  suppressNextFollowUpPubSub,
} from "@/modules/pubSub";
import type { ChatMessage } from "@/modules/types";
import ChatInterface from "./ChatInterface";

const [updateChatGenerationState, , getChatGenerationState] =
  chatGenerationStatePubSub;
const [updateChatInput] = chatInputPubSub;
const [updateFollowUpQuestion, , getFollowUpQuestion] = followUpQuestionPubSub;
const [updateSuppressNextFollowUp] = suppressNextFollowUpPubSub;
const [updateChatMessages, , getChatMessages] = chatMessagesPubSub;

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

/** The search run the chat belongs to; a test changes it to start a new search. */
let currentSearchRunId = "run-1";
vi.mock("@/modules/history", () => ({
  getCurrentSearchRunId: vi.fn(() => currentSearchRunId),
}));

vi.mock("@/modules/notifications", () => ({
  showAiCompleteNotification: vi.fn(),
}));

vi.mock("@/modules/logEntries", () => ({ addLogEntry: vi.fn() }));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

vi.mock("./ChatHeader", () => ({ default: () => null }));

let sendMessage: (textToSend?: string) => Promise<void>;
let regenerateResponse: () => Promise<void>;
let editMessage: (absoluteIndex: number) => void;
let messageListMessages: ChatMessage[] = [];
let messageListIsGenerating = false;
let messageListFollowUpStartIndex: number | undefined;

vi.mock("./ChatInputArea", () => ({
  default: (props: { handleSend: (textToSend?: string) => Promise<void> }) => {
    sendMessage = props.handleSend;
    return null;
  },
}));

vi.mock("./MessageList", () => ({
  default: (props: {
    messages: ChatMessage[];
    followUpStartIndex: number;
    isGenerating: boolean;
    onRegenerate: () => Promise<void>;
    onEditMessage: (absoluteIndex: number) => void;
  }) => {
    regenerateResponse = props.onRegenerate;
    editMessage = props.onEditMessage;
    messageListMessages = props.messages;
    messageListFollowUpStartIndex = props.followUpStartIndex;
    messageListIsGenerating = props.isGenerating;
    return null;
  },
}));

const { generateChatResponse } = await import("@/modules/textGeneration");
const { generateFollowUpQuestion } = await import(
  "@/modules/followUpQuestions"
);
const { persistChatConversation } = await import("@/modules/chatHelpers");
const { getCurrentSearchRunId } = await import("@/modules/history");
const { addLogEntry } = await import("@/modules/logEntries");
const { notifications } = await import("@mantine/notifications");

/** A promise plus the handle to settle it, so a test can hold a call open. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const initialQuery = "What is a wake lock?";
const initialResponse = "An API that keeps the screen on.";

function renderChatInterface({ suppressInitialFollowUp = true } = {}) {
  return render(
    <MantineProvider>
      <ChatInterface
        initialQuery={initialQuery}
        initialResponse={initialResponse}
        suppressInitialFollowUp={suppressInitialFollowUp}
      />
    </MantineProvider>,
  );
}

function stubWakeLockApi() {
  const release = vi.fn(() => Promise.resolve());
  const request = vi.fn(() =>
    Promise.resolve({ released: false, release, addEventListener: vi.fn() }),
  );

  Object.defineProperty(navigator, "wakeLock", {
    value: { request },
    configurable: true,
  });

  return { request, release };
}

beforeEach(() => {
  updateChatGenerationState({
    isGeneratingResponse: false,
    isGeneratingFollowUpQuestion: false,
  });
  updateChatInput("");
  updateFollowUpQuestion("");
  updateSuppressNextFollowUp(false);
  messageListMessages = [];
  messageListIsGenerating = false;
  messageListFollowUpStartIndex = undefined;
  vi.mocked(generateChatResponse).mockResolvedValue("An answer.");
  vi.mocked(generateFollowUpQuestion).mockResolvedValue("A question?");
  vi.mocked(persistChatConversation).mockResolvedValue(undefined);
  currentSearchRunId = "run-1";
  vi.mocked(getCurrentSearchRunId).mockImplementation(() => currentSearchRunId);
  updateChatMessages([]);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "wakeLock");
  vi.resetAllMocks();
});

describe("ChatInterface generation state", () => {
  it("leaves the follow-up question flag off after sending during its generation", async () => {
    const earlierQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      earlierQuestion.promise,
    );

    renderChatInterface({ suppressInitialFollowUp: false });

    await act(async () => {});

    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(true);

    await act(async () => {
      await sendMessage("And how do I use it?");
    });

    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(false);

    await act(async () => {
      earlierQuestion.resolve("An earlier question?");
    });
  });

  it("keeps the response flag on when an earlier follow-up question completes mid-response", async () => {
    const followUpQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      followUpQuestion.promise,
    );
    const chatResponse = deferred<string>();
    vi.mocked(generateChatResponse).mockReturnValueOnce(chatResponse.promise);

    renderChatInterface({ suppressInitialFollowUp: false });

    await act(async () => {});

    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(true);

    let send: Promise<void> = Promise.resolve();

    await act(async () => {
      send = sendMessage("And how do I use it?");
    });

    expect(getChatGenerationState().isGeneratingResponse).toBe(true);

    await act(async () => {
      followUpQuestion.resolve("An earlier question?");
    });

    expect(getChatGenerationState().isGeneratingResponse).toBe(true);

    await act(async () => {
      chatResponse.resolve("An answer.");
      await send;
    });
  });

  it("leaves a concurrent follow-up question flag alone when the response fails", async () => {
    const followUpQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      followUpQuestion.promise,
    );
    vi.mocked(generateChatResponse).mockRejectedValueOnce(
      new Error("no model"),
    );

    renderChatInterface({ suppressInitialFollowUp: false });

    await act(async () => {});

    await act(async () => {
      await sendMessage("And how do I use it?");
    });

    expect(getChatGenerationState()).toEqual({
      isGeneratingResponse: false,
      isGeneratingFollowUpQuestion: true,
    });

    await act(async () => {
      followUpQuestion.resolve("An earlier question?");
    });
  });

  it("starts one generation when two sends land in the same task", async () => {
    renderChatInterface();

    await act(async () => {
      await Promise.all([
        sendMessage("And how do I use it?"),
        sendMessage("Does it work offline?"),
      ]);
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(1);
  });

  it("accepts a send while the follow-up question is still being generated", async () => {
    const followUpQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      followUpQuestion.promise,
    );
    // Streams the answer, so the placeholder row holds it the way it does in
    // the app and a leftover copy would be visible.
    vi.mocked(generateChatResponse).mockImplementationOnce(
      async (_messages, onUpdate) => {
        onUpdate("An answer.");
        return "An answer.";
      },
    );

    renderChatInterface();

    let send: Promise<void> = Promise.resolve();

    await act(async () => {
      send = sendMessage("And how do I use it?");
    });

    expect(getChatGenerationState()).toEqual({
      isGeneratingResponse: false,
      isGeneratingFollowUpQuestion: true,
    });

    // The input stays enabled through this window, so the guard has to accept
    // the send rather than refuse it silently, and the streamed placeholder
    // must not leave a second copy of the answer in the list.
    expect(messageListIsGenerating).toBe(false);
    expect(
      messageListMessages.filter((message) => message.content === "An answer."),
    ).toHaveLength(1);

    await act(async () => {
      await sendMessage("Does it work offline?");
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);

    await act(async () => {
      followUpQuestion.resolve("An earlier question?");
      await send;
    });
  });

  it("regenerates without clobbering a follow-up question in flight", async () => {
    const followUpQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      followUpQuestion.promise,
    );
    const regeneratedQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      regeneratedQuestion.promise,
    );
    const chatResponse = deferred<string>();
    vi.mocked(generateChatResponse)
      .mockResolvedValueOnce("An answer.")
      .mockReturnValueOnce(chatResponse.promise);

    renderChatInterface();

    let send: Promise<void> = Promise.resolve();

    await act(async () => {
      send = sendMessage("And how do I use it?");
    });

    let regenerate: Promise<void> = Promise.resolve();

    await act(async () => {
      regenerate = regenerateResponse();
    });

    expect(getChatGenerationState().isGeneratingResponse).toBe(true);
    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(true);

    await act(async () => {
      followUpQuestion.resolve("An earlier question?");
    });

    expect(getChatGenerationState().isGeneratingResponse).toBe(true);

    await act(async () => {
      chatResponse.resolve("A regenerated answer.");
    });

    // The regenerate hands the lock over the way the send does: it must not
    // stay in the response phase while its own question is still coming.
    expect(getChatGenerationState()).toEqual({
      isGeneratingResponse: false,
      isGeneratingFollowUpQuestion: true,
    });

    await act(async () => {
      regeneratedQuestion.resolve("A later question?");
      await Promise.all([send, regenerate]);
    });
  });

  it("keeps the follow-up question flag on until the newest call finishes", async () => {
    const earlierQuestion = deferred<string>();
    const newerQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion)
      .mockReturnValueOnce(earlierQuestion.promise)
      .mockReturnValueOnce(newerQuestion.promise);

    renderChatInterface({ suppressInitialFollowUp: false });
    await act(async () => {});

    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(true);

    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = sendMessage("And how do I use it?");
    });

    // The orphaned call settles first. Its completion must write nothing.
    await act(async () => {
      earlierQuestion.resolve("The previous answer's question?");
    });

    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(true);
    expect(getFollowUpQuestion()).toBe("");

    await act(async () => {
      newerQuestion.resolve("The newest question?");
      await send;
    });

    expect(getFollowUpQuestion()).toBe("The newest question?");
    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(false);
  });

  it("leaves both generation flags off after unmounting mid-generation", async () => {
    const heldQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      heldQuestion.promise,
    );

    const { unmount } = renderChatInterface({ suppressInitialFollowUp: false });
    await act(async () => {});

    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(true);

    await act(async () => {
      unmount();
    });

    expect(getChatGenerationState()).toEqual({
      isGeneratingResponse: false,
      isGeneratingFollowUpQuestion: false,
    });

    // The orphaned call lands after the unmount; it must not write into what
    // is now the next mount's state.
    await act(async () => {
      heldQuestion.resolve("A question nobody asked for?");
    });

    expect(getChatGenerationState()).toEqual({
      isGeneratingResponse: false,
      isGeneratingFollowUpQuestion: false,
    });
    expect(getFollowUpQuestion()).toBe("");
  });

  it("leaves an in-flight call valid when a later one returns early", async () => {
    const heldQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      heldQuestion.promise,
    );
    // An empty answer makes the send's own follow-up call return at the
    // `!currentResponse` guard, without ever reaching the request.
    vi.mocked(generateChatResponse).mockResolvedValueOnce("");

    renderChatInterface({ suppressInitialFollowUp: false });
    await act(async () => {});

    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(true);

    await act(async () => {
      await sendMessage("And how do I use it?");
    });

    expect(generateFollowUpQuestion).toHaveBeenCalledTimes(1);

    await act(async () => {
      heldQuestion.resolve("The original question?");
    });

    // The early return bumped nothing, so the in-flight call is still the
    // current one and clears the flag. Bumping before the guards would have
    // orphaned it and left the flag, and the wake lock, held until unmount.
    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(false);
  });

  it("blanks nothing when an orphaned call rejects after a newer one started", async () => {
    const earlierQuestion = deferred<string>();
    const newerQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion)
      .mockReturnValueOnce(earlierQuestion.promise)
      .mockReturnValueOnce(newerQuestion.promise);

    renderChatInterface({ suppressInitialFollowUp: false });
    await act(async () => {});

    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = sendMessage("And how do I use it?");
    });

    // The orphaned call fails. Its catch must not blank the newer one's work.
    await act(async () => {
      earlierQuestion.reject(new Error("no model"));
    });

    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(true);

    await act(async () => {
      newerQuestion.resolve("The newest question?");
      await send;
    });

    expect(getFollowUpQuestion()).toBe("The newest question?");
    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(false);
  });

  it("starts no follow-up question for a send that settles after unmount", async () => {
    const chatResponse = deferred<string>();
    vi.mocked(generateChatResponse).mockReturnValueOnce(chatResponse.promise);

    const { unmount } = renderChatInterface();

    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = sendMessage("And how do I use it?");
    });

    await act(async () => {
      unmount();
    });

    // The send closure runs to the end regardless, and asks for a question the
    // dead instance's token would have accepted.
    await act(async () => {
      chatResponse.resolve("An answer.");
      await send;
    });

    expect(generateFollowUpQuestion).not.toHaveBeenCalled();
    expect(getFollowUpQuestion()).toBe("");
    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(false);
  });

  it("leaves the next mount's response flag alone when an orphaned send settles", async () => {
    const firstResponse = deferred<string>();
    const secondResponse = deferred<string>();
    vi.mocked(generateChatResponse)
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);

    const first = renderChatInterface();

    let firstSend: Promise<void> = Promise.resolve();
    await act(async () => {
      firstSend = sendMessage("And how do I use it?");
    });

    await act(async () => {
      first.unmount();
    });

    renderChatInterface();

    let secondSend: Promise<void> = Promise.resolve();
    await act(async () => {
      secondSend = sendMessage("Does it work offline?");
    });

    expect(getChatGenerationState().isGeneratingResponse).toBe(true);
    // The live generation really started, rather than the flag being stale.
    expect(generateChatResponse).toHaveBeenCalledTimes(2);

    // The orphan's `finally` must not clear the live generation's flag, which
    // would drop the spinner and let a third send start alongside it.
    await act(async () => {
      firstResponse.resolve("The orphaned answer.");
      await firstSend;
    });

    expect(getChatGenerationState().isGeneratingResponse).toBe(true);

    await act(async () => {
      secondResponse.resolve("The live answer.");
      await secondSend;
    });

    expect(getChatGenerationState().isGeneratingResponse).toBe(false);
  });

  it("leaves the next mount's response flag alone when an orphaned regenerate settles", async () => {
    const firstResponse = deferred<string>();
    const secondResponse = deferred<string>();
    vi.mocked(generateChatResponse)
      .mockResolvedValueOnce("An answer.")
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);

    const first = renderChatInterface();

    await act(async () => {
      await sendMessage("And how do I use it?");
    });

    let firstRegenerate: Promise<void> = Promise.resolve();
    await act(async () => {
      firstRegenerate = regenerateResponse();
    });

    await act(async () => {
      first.unmount();
    });

    renderChatInterface();

    let secondSend: Promise<void> = Promise.resolve();
    await act(async () => {
      secondSend = sendMessage("Does it work offline?");
    });

    expect(getChatGenerationState().isGeneratingResponse).toBe(true);
    // The live generation really started, rather than the flag being stale.
    expect(generateChatResponse).toHaveBeenCalledTimes(3);

    await act(async () => {
      firstResponse.resolve("The orphaned regeneration.");
      await firstRegenerate;
    });

    expect(getChatGenerationState().isGeneratingResponse).toBe(true);

    await act(async () => {
      secondResponse.resolve("The live answer.");
      await secondSend;
    });

    expect(getChatGenerationState().isGeneratingResponse).toBe(false);
  });

  it("starts one re-generation when two regenerates land in the same task", async () => {
    renderChatInterface();

    await act(async () => {
      await sendMessage("And how do I use it?");
    });

    await act(async () => {
      await Promise.all([regenerateResponse(), regenerateResponse()]);
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
  });

  it("keeps the response flag on when a follow-up question fails mid-response", async () => {
    const earlierQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      earlierQuestion.promise,
    );
    const chatResponse = deferred<string>();
    vi.mocked(generateChatResponse).mockReturnValueOnce(chatResponse.promise);

    renderChatInterface({ suppressInitialFollowUp: false });

    await act(async () => {});

    let send: Promise<void> = Promise.resolve();

    await act(async () => {
      send = sendMessage("And how do I use it?");
    });

    await act(async () => {
      earlierQuestion.reject(new Error("no model"));
    });

    expect(getChatGenerationState()).toEqual({
      isGeneratingResponse: true,
      isGeneratingFollowUpQuestion: false,
    });

    await act(async () => {
      chatResponse.resolve("An answer.");
      await send;
    });
  });

  it("holds the screen wake lock from the response through the follow-up question", async () => {
    const { request, release } = stubWakeLockApi();
    const followUpQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      followUpQuestion.promise,
    );

    renderChatInterface();

    let send: Promise<void> = Promise.resolve();

    await act(async () => {
      send = sendMessage("And how do I use it?");
    });

    expect(request).toHaveBeenCalledExactlyOnceWith("screen");
    expect(release).not.toHaveBeenCalled();

    await act(async () => {
      followUpQuestion.resolve("An earlier question?");
      await send;
    });

    expect(release).toHaveBeenCalled();
  });

  it("logs the failure when the initial follow-up question generation fails", async () => {
    vi.mocked(generateFollowUpQuestion).mockRejectedValueOnce(
      new Error("boom"),
    );

    renderChatInterface({ suppressInitialFollowUp: false });

    await act(async () => {});

    expect(addLogEntry).toHaveBeenCalledWith(
      expect.stringContaining("Error generating follow-up question"),
    );
    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(false);
  });

  it("keeps the answer and the follow-up question when persisting fails", async () => {
    vi.mocked(persistChatConversation).mockRejectedValueOnce(
      new Error("disk full"),
    );

    renderChatInterface();

    await act(async () => {
      await sendMessage("And how do I use it?");
    });

    expect(
      messageListMessages.filter((message) => message.content === "An answer."),
    ).toHaveLength(1);
    expect(
      messageListMessages.some((message) =>
        message.content.includes("Sorry, I encountered an error"),
      ),
    ).toBe(false);
    await vi.waitFor(() =>
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("Error persisting chat messages"),
      ),
    );
    expect(generateFollowUpQuestion).toHaveBeenCalled();
  });

  it("clears suppressNextFollowUp after skipping the restored answer's follow-up so later sends generate one", async () => {
    updateSuppressNextFollowUp(true);

    renderChatInterface({ suppressInitialFollowUp: false });

    await act(async () => {});

    expect(generateFollowUpQuestion).not.toHaveBeenCalled();
    expect(getSuppressNextFollowUp()).toBe(false);

    await act(async () => {
      await sendMessage("Tell me more about wake locks");
    });

    expect(generateFollowUpQuestion).toHaveBeenCalledTimes(1);
    expect(getFollowUpQuestion()).toBe("A question?");
  });

  it("drops an in-flight follow-up question when a restore suppresses follow-ups", async () => {
    const inFlightQuestion = deferred<string>();
    vi.mocked(generateFollowUpQuestion).mockReturnValueOnce(
      inFlightQuestion.promise,
    );

    renderChatInterface({ suppressInitialFollowUp: false });

    await act(async () => {});

    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(true);

    await act(async () => {
      updateSuppressNextFollowUp(true);
    });

    expect(getSuppressNextFollowUp()).toBe(false);
    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(false);
    expect(getFollowUpQuestion()).toBe("");

    await act(async () => {
      inFlightQuestion.resolve("Question from the previous search?");
    });

    expect(getFollowUpQuestion()).toBe("");
    expect(getChatGenerationState().isGeneratingFollowUpQuestion).toBe(false);
  });
});

describe("ChatInterface follow-up start", () => {
  const followUps: ChatMessage[] = [
    { role: "user", content: "Q1" },
    { role: "assistant", content: "A1" },
  ];

  function renderWithoutMainAnswer() {
    return render(
      <MantineProvider>
        <ChatInterface
          initialQuery={initialQuery}
          initialResponse=""
          initialMessages={followUps}
          suppressInitialFollowUp
        />
      </MantineProvider>,
    );
  }

  it("starts the follow-ups after the main question and answer", () => {
    renderChatInterface();

    expect(messageListMessages).toEqual([
      { role: "user", content: initialQuery },
      { role: "assistant", content: initialResponse },
    ]);
    expect(messageListFollowUpStartIndex).toBe(2);
  });

  it("starts the follow-ups at the top when the main answer is empty", () => {
    renderWithoutMainAnswer();

    expect(messageListMessages).toEqual(followUps);
    expect(messageListFollowUpStartIndex).toBe(0);
  });

  it("regenerates the first follow-up when the main answer is empty", async () => {
    renderWithoutMainAnswer();
    vi.mocked(generateChatResponse).mockResolvedValueOnce("A1 again");

    await act(async () => {
      await regenerateResponse();
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateChatResponse).mock.calls[0][0]).toEqual([
      followUps[0],
    ]);
    expect(messageListMessages.at(-1)).toEqual({
      role: "assistant",
      content: "A1 again",
    });
  });
});

describe("ChatInterface failed regeneration", () => {
  const nextQuestion = "And how do I use it?";

  async function sendThenFailRegenerate() {
    vi.mocked(generateChatResponse)
      .mockResolvedValueOnce("An answer.")
      .mockRejectedValueOnce(new Error("model crashed"));

    await act(async () => {
      await sendMessage(nextQuestion);
    });
    await act(async () => {
      await regenerateResponse();
    });
  }

  it("keeps the previous answer so it can be regenerated again", async () => {
    renderChatInterface();
    await sendThenFailRegenerate();

    expect(messageListMessages.at(-1)).toEqual({
      role: "assistant",
      content: "An answer.",
    });
    expect(messageListMessages).toHaveLength(4);
    expect(getChatGenerationState().isGeneratingResponse).toBe(false);

    vi.mocked(generateChatResponse).mockResolvedValueOnce("A second try.");
    await act(async () => {
      await regenerateResponse();
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(3);
    expect(messageListMessages.at(-1)?.content).toBe("A second try.");
  });

  it("shows one red notification and still logs the error", async () => {
    renderChatInterface();
    await sendThenFailRegenerate();

    expect(notifications.show).toHaveBeenCalledTimes(1);
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        color: "red",
        message:
          "Couldn't re-generate the response. The previous answer has been kept.",
      }),
    );
    expect(addLogEntry).toHaveBeenCalledWith(
      expect.stringContaining("Error re-generating response"),
    );
  });

  it("brings back the follow-up question that was showing", async () => {
    renderChatInterface();
    await sendThenFailRegenerate();

    expect(getFollowUpQuestion()).toBe("A question?");
  });

  it("writes nothing and shows no notification after unmounting", async () => {
    const response = deferred<string>();
    vi.mocked(generateChatResponse)
      .mockResolvedValueOnce("An answer.")
      .mockReturnValueOnce(response.promise);

    const { unmount } = renderChatInterface();
    await act(async () => {
      await sendMessage(nextQuestion);
    });

    let regenerate: Promise<void> = Promise.resolve();
    await act(async () => {
      regenerate = regenerateResponse();
    });
    await act(async () => {
      unmount();
    });
    updateFollowUpQuestion("A question from the next chat?");

    await act(async () => {
      response.reject(new Error("model crashed"));
      await regenerate;
    });

    expect(notifications.show).not.toHaveBeenCalled();
    expect(getFollowUpQuestion()).toBe("A question from the next chat?");
  });

  it("shows no notification when the regeneration succeeds", async () => {
    vi.mocked(generateChatResponse)
      .mockResolvedValueOnce("An answer.")
      .mockResolvedValueOnce("A regenerated answer.");

    renderChatInterface();
    await act(async () => {
      await sendMessage(nextQuestion);
    });
    await act(async () => {
      await regenerateResponse();
    });

    expect(messageListMessages.at(-1)?.content).toBe("A regenerated answer.");
    expect(notifications.show).not.toHaveBeenCalled();
  });
});

describe("ChatInterface previous follow-up questions", () => {
  it("does not record an empty follow-up question", async () => {
    vi.mocked(generateFollowUpQuestion)
      .mockResolvedValueOnce("Is it supported in Safari?")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("Does it drain the battery?");

    renderChatInterface({ suppressInitialFollowUp: false });
    await act(async () => {});

    await act(async () => {
      await sendMessage("And how do I use it?");
    });
    await act(async () => {
      await sendMessage("Does it work in the background?");
    });

    expect(generateFollowUpQuestion).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(generateFollowUpQuestion).mock.calls[2][0].previousQuestions,
    ).toEqual(["Is it supported in Safari?"]);
  });
});

describe("ChatInterface chat storage", () => {
  const followUps = (...pairs: [string, string][]): ChatMessage[] =>
    pairs.flatMap(([question, answer]) => [
      { role: "user" as const, content: question },
      { role: "assistant" as const, content: answer },
    ]);

  /** What the last write stored for a conversation. */
  function stored(conversationId = "run-1") {
    const calls = vi
      .mocked(persistChatConversation)
      .mock.calls.filter(([id]) => id === conversationId);
    return calls.at(-1)?.[1];
  }

  it("stores the regenerated answer in place of the one it replaced", async () => {
    vi.mocked(generateChatResponse)
      .mockResolvedValueOnce("First answer.")
      .mockResolvedValueOnce("Regenerated answer.");
    renderChatInterface();

    await act(async () => {
      await sendMessage("How do I use it?");
    });
    await act(async () => {
      await regenerateResponse();
    });

    expect(stored()).toEqual(
      followUps(["How do I use it?", "Regenerated answer."]),
    );
  });

  it("stores only the corrected pair after an edit and a resend", async () => {
    vi.mocked(generateChatResponse)
      .mockResolvedValueOnce("Answer to the typo.")
      .mockResolvedValueOnce("Answer to the fix.");
    renderChatInterface();

    await act(async () => {
      await sendMessage("How do I use iy?");
    });
    act(() => editMessage(2));
    await act(async () => {
      await sendMessage("How do I use it?");
    });

    expect(stored()).toEqual(
      followUps(["How do I use it?", "Answer to the fix."]),
    );
  });

  it("matches the screen after an edit that is never resent", async () => {
    renderChatInterface();

    await act(async () => {
      await sendMessage("How do I use it?");
    });
    act(() => editMessage(2));

    expect(stored()).toEqual([]);
    expect(messageListMessages).toHaveLength(2);
  });

  it("stores the question of a failed send, then the answer that regenerates it", async () => {
    vi.mocked(generateChatResponse)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("A good answer.");
    renderChatInterface();

    await act(async () => {
      await sendMessage("How do I use it?");
    });
    expect(stored()?.[0]).toEqual({
      role: "user",
      content: "How do I use it?",
    });

    await act(async () => {
      await regenerateResponse();
    });

    expect(stored()).toEqual(followUps(["How do I use it?", "A good answer."]));
  });

  it("saves an answer under its own search when a new search starts meanwhile", async () => {
    const answer = deferred<string>();
    vi.mocked(generateChatResponse).mockReturnValueOnce(answer.promise);
    renderChatInterface();

    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = sendMessage("How do I use it?");
    });
    currentSearchRunId = "run-2";
    await act(async () => {
      answer.resolve("A late answer.");
      await send;
    });

    expect(stored("run-1")).toEqual(
      followUps(["How do I use it?", "A late answer."]),
    );
    expect(stored("run-2")).toBeUndefined();
    // The new search's copy is not given the old search's turns.
    expect(getChatMessages()).toEqual([]);
  });

  it("keeps every turn on a remount without writing anything", async () => {
    vi.mocked(generateChatResponse)
      .mockResolvedValueOnce("One.")
      .mockResolvedValueOnce("Two.");
    const first = renderChatInterface();
    await act(async () => {
      await sendMessage("Q1");
    });
    await act(async () => {
      await sendMessage("Q2");
    });
    first.unmount();
    const writes = vi.mocked(persistChatConversation).mock.calls.length;

    render(
      <MantineProvider>
        <ChatInterface
          initialQuery={initialQuery}
          initialResponse={initialResponse}
          initialMessages={getChatMessages()}
          suppressInitialFollowUp
        />
      </MantineProvider>,
    );

    expect(messageListMessages.map((m) => m.content)).toEqual([
      initialQuery,
      initialResponse,
      "Q1",
      "One.",
      "Q2",
      "Two.",
    ]);
    expect(persistChatConversation).toHaveBeenCalledTimes(writes);
  });
});
