import { Button, Group, Textarea } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import DictationButton, {
  dictationButtonWidth,
} from "@/components/DictationButton";
import {
  chatGenerationStatePubSub,
  chatInputPubSub,
  followUpQuestionPubSub,
  getChatInput,
  isRestoringFromHistoryPubSub,
  suppressNextFollowUpPubSub,
} from "@/modules/pubSub";

/**
 * Width of the send button, pinned rather than left to Mantine's padding: the
 * field reserves this much room beside itself and the dictation button is
 * offset by it, so a change in the button's intrinsic width would otherwise
 * slide the two controls on top of each other.
 */
const sendButtonWidth = 54;
/** Keeps the typed text off the dictation button. */
const dictationGutter = 4;

interface ChatInputAreaProps {
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSend: (textToSend?: string) => void;
}

function ChatInputArea({ onKeyDown, handleSend }: ChatInputAreaProps) {
  const [input, setInput] = usePubSub(chatInputPubSub);
  const [generationState] = usePubSub(chatGenerationStatePubSub);
  const [followUpQuestion] = usePubSub(followUpQuestionPubSub);
  const [isRestoringFromHistory] = usePubSub(isRestoringFromHistoryPubSub);
  const [suppressNextFollowUp] = usePubSub(suppressNextFollowUpPubSub);

  const isGenerating =
    generationState.isGeneratingResponse &&
    !generationState.isGeneratingFollowUpQuestion;

  const defaultPlaceholder = "Anything else you would like to know?";
  const placeholder =
    isRestoringFromHistory || suppressNextFollowUp
      ? defaultPlaceholder
      : followUpQuestion || defaultPlaceholder;

  const onChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };
  const handleKeyDownWithPlaceholder = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    // Same IME guard as handleEnterKeyDown: the Enter that confirms a
    // composition candidate must not fire the follow-up question while the
    // composition text has not reached the input value yet.
    const isComposing = event.nativeEvent.isComposing || event.keyCode === 229;

    if (
      input.trim() === "" &&
      followUpQuestion &&
      !isRestoringFromHistory &&
      !suppressNextFollowUp &&
      !isComposing
    ) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSend(followUpQuestion);
        return;
      }
    }

    onKeyDown(event);
  };

  const handleSendWithPlaceholder = () => {
    if (
      input.trim() === "" &&
      followUpQuestion &&
      !isRestoringFromHistory &&
      !suppressNextFollowUp
    ) {
      handleSend(followUpQuestion);
    } else {
      handleSend();
    }
  };

  return (
    <Group align="flex-end" style={{ position: "relative" }}>
      <Textarea
        size="sm"
        aria-label="Chat input"
        placeholder={placeholder}
        value={input}
        onChange={onChange}
        onKeyDown={handleKeyDownWithPlaceholder}
        autosize
        minRows={1}
        maxRows={8}
        style={{ flexGrow: 1, paddingRight: `${sendButtonWidth}px` }}
        styles={{
          input: { paddingRight: dictationButtonWidth + dictationGutter },
        }}
        disabled={isGenerating}
      />
      <DictationButton
        getValue={getChatInput}
        setValue={setInput}
        labelScope="a follow-up question"
        rightOffset={sendButtonWidth}
        disabled={isGenerating}
      />
      <Button
        aria-label="Send message"
        size="sm"
        variant="default"
        w={sendButtonWidth}
        onClick={handleSendWithPlaceholder}
        loading={isGenerating}
        style={{
          height: "100%",
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
        }}
      >
        <IconSend size={16} />
      </Button>
    </Group>
  );
}

export default ChatInputArea;
