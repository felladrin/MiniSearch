import { MantineProvider } from "@mantine/core";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatGenerationStatePubSub,
  chatInputPubSub,
  followUpQuestionPubSub,
  suppressNextFollowUpPubSub,
} from "@/modules/pubSub";
import type { ChatMessage } from "@/modules/types";
import ChatInterface from "./ChatInterface";

const [updateChatGenerationState, , getChatGenerationState] =
  chatGenerationStatePubSub;
const [updateChatInput] = chatInputPubSub;
const [updateFollowUpQuestion, , getFollowUpQuestion] = followUpQuestionPubSub;
const [updateSuppressNextFollowUp] = suppressNextFollowUpPubSub;

vi.mock("@/modules/textGeneration", () => ({
  generateChatResponse: vi.fn(),
}));

vi.mock("@/modules/followUpQuestions", () => ({
  generateFollowUpQuestion: vi.fn(),
}));

vi.mock("@/modules/chatHelpers", () => ({
  persistChatMessages: vi.fn(() => Promise.resolve()),
  runFollowUpSearch: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/modules/notifications", () => ({
  showAiCompleteNotification: vi.fn(),
}));

vi.mock("@/modules/logEntries", () => ({ addLogEntry: vi.fn() }));

vi.mock("./ChatHeader", () => ({ default: () => null }));

let sendMessage: (textToSend?: string) => Promise<void>;
let regenerateResponse: () => Promise<void>;
let messageListMessages: ChatMessage[] = [];
let messageListIsGenerating = false;

vi.mock("./ChatInputArea", () => ({
  default: (props: { handleSend: (textToSend?: string) => Promise<void> }) => {
    sendMessage = props.handleSend;
    return null;
  },
}));

vi.mock("./MessageList", () => ({
  default: (props: {
    messages: ChatMessage[];
    isGenerating: boolean;
    onRegenerate: () => Promise<void>;
  }) => {
    regenerateResponse = props.onRegenerate;
    messageListMessages = props.messages;
    messageListIsGenerating = props.isGenerating;
    return null;
  },
}));

const { generateChatResponse } = await import("@/modules/textGeneration");
const { generateFollowUpQuestion } = await import(
  "@/modules/followUpQuestions"
);

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
  vi.mocked(generateChatResponse).mockResolvedValue("An answer.");
  vi.mocked(generateFollowUpQuestion).mockResolvedValue("A question?");
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

    // Only the held call ever asked for a question.
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
});
