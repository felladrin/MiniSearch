import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/modules/types";
import MessageList from "./MessageList";

// Stub the highlighter so MarkdownRenderer doesn't load Shiki
vi.mock("@mantine/code-highlight", () => ({
  CodeHighlight: ({ code }: { code: string }) => <div>{code}</div>,
}));

function renderMessageList(props: {
  messages: ChatMessage[];
  onEditMessage?: (absoluteIndex: number) => void;
  onRegenerate?: () => void;
  isGenerating?: boolean;
}) {
  return render(
    <MantineProvider>
      <MessageList
        messages={props.messages}
        onEditMessage={props.onEditMessage ?? vi.fn()}
        onRegenerate={props.onRegenerate ?? vi.fn()}
        isGenerating={props.isGenerating ?? false}
      />
    </MantineProvider>,
  );
}

describe("MessageList", () => {
  it("renders nothing when there are 2 or fewer messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "system instructions" },
      { role: "assistant", content: "Ok!" },
    ];
    const { container } = renderMessageList({ messages });
    expect(container.querySelector(".mantine-Stack-root")).toBeNull();
  });

  it("renders two separate messages when the same question is asked twice", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "system instructions" },
      { role: "assistant", content: "Ok!" },
      { role: "user", content: "what is the capital of France?" },
      { role: "assistant", content: "Paris" },
      { role: "user", content: "what is the capital of France?" },
    ];

    renderMessageList({ messages });

    const renderedQuestions = screen.getAllByText(
      "what is the capital of France?",
    );
    expect(renderedQuestions).toHaveLength(2);
  });
});
