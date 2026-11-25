import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/modules/types";
import MessageList from "./MessageList";

// Stub the highlighter so MarkdownRenderer doesn't load Shiki
vi.mock("@mantine/code-highlight", () => ({
  CodeHighlight: ({ code }: { code: string }) => <div>{code}</div>,
}));

function renderMessageList(props: {
  messages: ChatMessage[];
  followUpStartIndex?: number;
  onEditMessage?: (absoluteIndex: number) => void;
  onRegenerate?: () => void;
  isGenerating?: boolean;
}) {
  return render(
    <MantineProvider>
      <MessageList
        messages={props.messages}
        followUpStartIndex={props.followUpStartIndex ?? 2}
        onEditMessage={props.onEditMessage ?? vi.fn()}
        onRegenerate={props.onRegenerate ?? vi.fn()}
        isGenerating={props.isGenerating ?? false}
      />
    </MantineProvider>,
  );
}

describe("MessageList", () => {
  it("renders nothing when there are no follow-up messages", () => {
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

  describe("an empty answer earlier in the chat", () => {
    // An empty answer is saved when the stream ends with no content.
    const messages: ChatMessage[] = [
      { role: "user", content: "system instructions" },
      { role: "assistant", content: "Ok!" },
      { role: "user", content: "Q1" },
      { role: "assistant", content: "" },
      { role: "user", content: "Q2" },
      { role: "assistant", content: "" },
      { role: "user", content: "Q3" },
      { role: "assistant", content: "A3" },
    ];

    it("edits each question at its position in the chat", () => {
      const onEditMessage = vi.fn();
      renderMessageList({ messages, onEditMessage });

      const editButtons = screen.getAllByLabelText("Edit message");
      expect(editButtons).toHaveLength(3);
      for (const button of editButtons) fireEvent.click(button);

      expect(onEditMessage.mock.calls).toEqual([[2], [4], [6]]);
    });

    it("keeps the Re-generate button on the last answer", () => {
      const onRegenerate = vi.fn();
      renderMessageList({ messages, onRegenerate });

      fireEvent.click(screen.getByLabelText("Re-generate response"));

      expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    it("renders no bubble for the empty answers", () => {
      renderMessageList({ messages });

      expect(screen.getAllByText(/^(Q1|Q2|Q3|A3)$/)).toHaveLength(4);
      expect(document.querySelectorAll(".mantine-Paper-root")).toHaveLength(4);
    });
  });

  describe("no main question and answer", () => {
    // When the main answer came back empty, the follow-ups start at 0.
    const messages: ChatMessage[] = [
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ];

    it("renders the first follow-up pair", () => {
      renderMessageList({ messages, followUpStartIndex: 0 });

      expect(screen.getByText("Q1")).toBeInTheDocument();
      expect(screen.getByText("A1")).toBeInTheDocument();
    });

    it("edits the first follow-up question at position 0", () => {
      const onEditMessage = vi.fn();
      renderMessageList({ messages, followUpStartIndex: 0, onEditMessage });

      fireEvent.click(screen.getByLabelText("Edit message"));

      expect(onEditMessage).toHaveBeenCalledWith(0);
    });
  });

  describe("an empty last answer", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "system instructions" },
      { role: "assistant", content: "Ok!" },
      { role: "user", content: "Q1" },
      { role: "assistant", content: "" },
    ];

    it("shows No response with a Re-generate button", () => {
      const onRegenerate = vi.fn();
      renderMessageList({ messages, onRegenerate });

      expect(screen.getByText("No response")).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("Re-generate response"));
      expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    it("shows no bubble for it while the answer is being generated", () => {
      renderMessageList({ messages, isGenerating: true });

      expect(screen.queryByText("No response")).toBeNull();
      expect(document.querySelectorAll(".mantine-Paper-root")).toHaveLength(1);
    });
  });

  describe("unterminated reasoning", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "system instructions" },
      { role: "assistant", content: "Ok!" },
      { role: "user", content: "why?" },
      { role: "assistant", content: "<think>cut off mid-thought" },
    ];

    it("shows no Thinking loader on a message that is not being generated", () => {
      renderMessageList({ messages, isGenerating: false });

      expect(screen.queryByText("Thinking")).toBeNull();
      expect(screen.getByText("Thought Process")).toBeInTheDocument();
    });

    it("shows the Thinking loader on the last assistant message while it is generated", () => {
      renderMessageList({ messages, isGenerating: true });

      expect(screen.getByText("Thinking")).toBeInTheDocument();
    });

    it("shows no Thinking loader on an older message while a later one is generated", () => {
      renderMessageList({
        messages: [...messages, { role: "user", content: "and then?" }],
        isGenerating: true,
      });

      expect(screen.queryByText("Thinking")).toBeNull();
    });
  });
});
