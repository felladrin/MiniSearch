import { act, cleanup, render } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getChatSession,
  getSettings,
  settingsPubSub,
  updateChatMessages,
  updateChatSession,
  updateResponseImmediately,
  updateTextGenerationState,
} from "@/modules/pubSub";
import AiResponseSection from "./AiResponseSection";

const [updateSettings] = settingsPubSub;

vi.mock("@mantine/code-highlight", () => ({
  CodeHighlightAdapterProvider: ({ children }: { children: ReactNode }) =>
    children,
}));
vi.mock("@mantine/code-highlight/styles.css", () => ({}));
vi.mock("@/modules/shiki", () => ({ shikiAdapter: {} }));
vi.mock("./AiResponseContent", () => ({ default: () => null }));

const chatLifecycle = { mounts: 0, unmounts: 0 };

// What the chat's unmount does (abort the follow-up, save it as interrupted
// under its own search, drop the suggestion) is covered in
// ChatInterface.test.tsx; this only checks when the chat is remounted.
vi.mock("./ChatInterface", () => ({
  default: () => {
    useEffect(() => {
      chatLifecycle.mounts += 1;
      return () => {
        chatLifecycle.unmounts += 1;
      };
    }, []);
    return null;
  },
}));

beforeEach(() => {
  chatLifecycle.mounts = 0;
  chatLifecycle.unmounts = 0;
  updateSettings({ ...getSettings(), enableAiResponse: true });
  updateResponseImmediately("Answer A");
  updateChatMessages([]);
  updateTextGenerationState("completed");
});

afterEach(() => {
  cleanup();
});

describe("AiResponseSection", () => {
  it("remounts the chat for a new chat session, and only then", () => {
    render(<AiResponseSection />);
    expect(chatLifecycle).toEqual({ mounts: 1, unmounts: 0 });

    act(() => {
      updateResponseImmediately("Answer B");
      updateChatMessages([
        { role: "user", content: "A follow-up" },
        { role: "assistant", content: "Its answer" },
      ]);
    });
    expect(chatLifecycle).toEqual({ mounts: 1, unmounts: 0 });

    act(() => updateChatSession(getChatSession() + 1));
    expect(chatLifecycle).toEqual({ mounts: 2, unmounts: 1 });
  });
});
