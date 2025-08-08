import { Button, Group, Textarea } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import {
  chatGenerationStatePubSub,
  chatInputPubSub,
  followUpQuestionPubSub,
} from "../../modules/pubSub";

interface ChatInputAreaProps {
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSend: (textToSend?: string) => void;
}

function ChatInputArea({ onKeyDown, handleSend }: ChatInputAreaProps) {
  const [input, setInput] = usePubSub(chatInputPubSub);
  const [generationState] = usePubSub(chatGenerationStatePubSub);
  const [followUpQuestion] = usePubSub(followUpQuestionPubSub);

  const isGenerating =
    generationState.isGeneratingResponse &&
    !generationState.isGeneratingFollowUpQuestion;

  const placeholder =
    followUpQuestion || "Anything else you would like to know?";

  const onChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };
  const handleKeyDownWithPlaceholder = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (input.trim() === "" && followUpQuestion) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSend(followUpQuestion);
        return;
      }
    }

    onKeyDown(event);
  };

  const handleSendWithPlaceholder = () => {
    if (input.trim() === "" && followUpQuestion) {
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
        maxRows={4}
        style={{ flexGrow: 1, paddingRight: "50px" }}
        disabled={isGenerating}
      />
      <Button
        aria-label="Send message"
        size="sm"
        variant="default"
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
