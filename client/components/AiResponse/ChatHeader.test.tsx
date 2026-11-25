import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/modules/types";
import ChatHeader from "./ChatHeader";

// Show the text the copy button would put on the clipboard.
vi.mock("./CopyIconButton", () => ({
  default: ({ value }: { value: string }) => (
    <pre data-testid="copied-conversation">{value}</pre>
  ),
}));

function renderChatHeader(messages: ChatMessage[], followUpStartIndex: number) {
  return render(
    <MantineProvider>
      <ChatHeader messages={messages} followUpStartIndex={followUpStartIndex} />
    </MantineProvider>,
  );
}

describe("ChatHeader", () => {
  it("copies the follow-ups that come after the main question and answer", () => {
    renderChatHeader(
      [
        { role: "user", content: "Main question" },
        { role: "assistant", content: "Main answer" },
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
      ],
      2,
    );

    expect(screen.getByTestId("copied-conversation").textContent).toBe(
      "1. USER\n\nQ1\n\n2. ASSISTANT\n\nA1",
    );
  });

  it("copies the first follow-up pair when there is no main question and answer", () => {
    renderChatHeader(
      [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
      ],
      0,
    );

    expect(screen.getByTestId("copied-conversation").textContent).toBe(
      "1. USER\n\nQ1\n\n2. ASSISTANT\n\nA1",
    );
  });

  it("shows no copy button before the first follow-up", () => {
    renderChatHeader(
      [
        { role: "user", content: "Main question" },
        { role: "assistant", content: "Main answer" },
      ],
      2,
    );

    expect(screen.queryByTestId("copied-conversation")).toBeNull();
  });
});
