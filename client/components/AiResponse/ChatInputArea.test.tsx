import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import ChatInputArea from "@/components/AiResponse/ChatInputArea";
import { chatGenerationStatePubSub, chatInputPubSub } from "@/modules/pubSub";
import { getDictationEngine, startDictation } from "@/modules/speechToText";

vi.mock("@/modules/speechToText", async () => {
  const { DictationError: RealDictationError } = await import(
    "@/modules/speechToText"
  );
  return {
    DictationError: RealDictationError,
    getDictationEngine: vi.fn(() => "wasm" as const),
    startDictation: vi.fn(),
  };
});

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

/** Subscribes for real, so a channel written mid-test re-renders the area. */
vi.mock("create-pubsub/react", () => ({
  usePubSub: (pubSub: [unknown, unknown, unknown]) => {
    const [publish, subscribe, get] = pubSub as [
      unknown,
      (listener: () => void) => () => void,
      () => unknown,
    ];
    const value = useSyncExternalStore(subscribe, get, get);
    return [value, publish];
  },
}));

const stopFn = vi.fn();

function renderChatInputArea() {
  return render(
    <MantineProvider>
      <ChatInputArea onKeyDown={() => {}} handleSend={() => {}} />
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getDictationEngine).mockReturnValue("wasm");
  vi.mocked(startDictation).mockResolvedValue({ stop: stopFn });
  chatInputPubSub[0]("");
  chatGenerationStatePubSub[0]({
    isGeneratingResponse: false,
    isGeneratingFollowUpQuestion: false,
  });
});

it("places the dictation button left of the send button", () => {
  renderChatInputArea();

  const dictate = screen.getByRole("button", {
    name: "Dictate a follow-up question",
  });
  const send = screen.getByRole("button", { name: "Send message" });

  // Both float over the right end of the field, so only the offsets say
  // which is where. Send keeps the edge; dictation sits inside the field.
  expect(send).toHaveStyle({ right: "0px" });
  expect(dictate).toHaveStyle({ right: "54px" });

  // And the tab order follows the same left-to-right reading.
  expect(
    dictate.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("writes the transcript into the chat input", async () => {
  chatInputPubSub[0]("tell me");
  let onTranscript: (text: string) => void = () => {};
  vi.mocked(startDictation).mockImplementation(async (callbacks) => {
    onTranscript = callbacks.onTranscript;
    return { stop: stopFn };
  });

  const user = userEvent.setup();
  renderChatInputArea();

  await user.click(
    screen.getByRole("button", { name: "Dictate a follow-up question" }),
  );
  await waitFor(() => expect(startDictation).toHaveBeenCalledTimes(1));

  onTranscript("more about this");

  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Chat input" })).toHaveValue(
      "tell me more about this",
    ),
  );
});

it("disables dictation while a response is generating", async () => {
  renderChatInputArea();

  chatGenerationStatePubSub[0]({
    isGeneratingResponse: true,
    isGeneratingFollowUpQuestion: false,
  });

  // Disabled rather than hidden: the control keeps its place in the field
  // instead of the send button jumping left for the length of an answer.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Dictate a follow-up question" }),
    ).toBeDisabled(),
  );
});

it("stops a running session when a response starts generating", async () => {
  const user = userEvent.setup();
  renderChatInputArea();

  await user.click(
    screen.getByRole("button", { name: "Dictate a follow-up question" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Stop dictating a follow-up question",
      }),
    ).toBeInTheDocument(),
  );

  chatGenerationStatePubSub[0]({
    isGeneratingResponse: true,
    isGeneratingFollowUpQuestion: false,
  });

  // The field goes read-only while the answer streams, and `handleSend`
  // clears it: a session still running would splice its transcript onto an
  // input the user cannot see or correct.
  await waitFor(() => expect(stopFn).toHaveBeenCalledTimes(1));
});
