import { Button, Group, Textarea } from "@mantine/core";
import { Suspense, lazy } from "react";

const IconSend = lazy(() =>
  import("@tabler/icons-react").then((module) => ({
    default: module.IconSend,
  })),
);

interface ChatInputAreaProps {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSend: () => void;
  isGenerating: boolean;
}

function ChatInputArea({
  value,
  onChange,
  onKeyDown,
  handleSend,
  isGenerating,
}: ChatInputAreaProps) {
  return (
    <Group align="flex-end" style={{ position: "relative" }}>
      <Textarea
        aria-label="Chat input"
        placeholder="Anything else you would like to know?"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
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
        onClick={handleSend}
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
        <Suspense fallback={<span>→</span>}>
          <IconSend size={16} />
        </Suspense>
      </Button>
    </Group>
  );
}

export default ChatInputArea;
