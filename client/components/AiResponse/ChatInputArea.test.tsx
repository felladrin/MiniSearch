import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatInputArea from "@/components/AiResponse/ChatInputArea";
import {
  chatGenerationStatePubSub,
  chatInputPubSub,
  followUpQuestionPubSub,
  settingsPubSub,
} from "@/modules/pubSub";
import { defaultSettings } from "@/modules/settings";
import { getDictationEngine, startDictation } from "@/modules/speechToText";

// jscpd:ignore-start
// Vitest hoists every vi.mock call above the imports, so the registration has
// to be written out in each file; only the factory body can be shared, and it
// is. The duplication is the framework's, not the tests'.
vi.mock("@/modules/speechToText", async () =>
  (await import("@/testMocks")).speechToTextMock(),
);
vi.mock("@mantine/notifications", async () =>
  (await import("@/testMocks")).notificationsStub(),
);
vi.mock("create-pubsub/react", async () =>
  (await import("@/testMocks")).pubSubReactMock(),
);
// jscpd:ignore-end

const stopFn = vi.fn();
const cancelFn = vi.fn();

function renderChatInputArea() {
  return render(
    <MantineProvider>
      <ChatInputArea onKeyDown={() => {}} handleSend={() => {}} />
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getDictationEngine).mockReturnValue("wasm");
  vi.mocked(startDictation).mockResolvedValue({
    stop: stopFn,
    cancel: cancelFn,
  });
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
  // which is where. Send keeps the edge; dictation sits inside the field,
  // clear of the 1px border it shares with send.
  expect(send).toHaveStyle({ right: "0px" });
  expect(dictate).toHaveStyle({ right: "55px" });

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
    return { stop: stopFn, cancel: cancelFn };
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
  await waitFor(() => expect(cancelFn).toHaveBeenCalledTimes(1));
});

describe("sending the suggested follow-up question", () => {
  afterEach(() => {
    followUpQuestionPubSub[0]("");
    settingsPubSub[0]({ ...defaultSettings });
  });

  it.each([
    [true, "{Enter}", true],
    [true, "{Shift>}{Enter}{/Shift}", false],
    [false, "{Shift>}{Enter}{/Shift}", true],
    [false, "{Enter}", false],
  ])(
    "with enterToSubmit %s, pressing %s sends it: %s",
    async (enterToSubmit, keys, sends) => {
      settingsPubSub[0]({ ...defaultSettings, enterToSubmit });
      followUpQuestionPubSub[0]("What happened next?");
      const handleSend = vi.fn();
      const user = userEvent.setup();
      render(
        <MantineProvider>
          <ChatInputArea onKeyDown={() => {}} handleSend={handleSend} />
        </MantineProvider>,
      );

      await user.click(screen.getByRole("textbox"));
      await user.keyboard(keys);

      if (sends) {
        expect(handleSend).toHaveBeenCalledWith("What happened next?");
      } else {
        expect(handleSend).not.toHaveBeenCalled();
      }
    },
  );
});
