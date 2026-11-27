import { act, render } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSearchRunId, setCurrentSearchRunId } from "@/modules/history";
import {
  getSettings,
  isRestoringFromHistoryPubSub,
  settingsPubSub,
  textGenerationStatePubSub,
} from "@/modules/pubSub";
import AiResponseSection from "./AiResponseSection";

const chatLifecycle = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
}));

vi.mock("@/hooks/useScreenWakeLock", () => ({
  useScreenWakeLock: vi.fn(),
}));

vi.mock("@mantine/code-highlight", () => ({
  CodeHighlightAdapterProvider: ({ children }: { children: ReactNode }) =>
    children,
}));

vi.mock("@/modules/shiki", () => ({
  shikiAdapter: {},
}));

vi.mock("./AiResponseContent", () => ({
  default: () => null,
}));

vi.mock("./ChatInterface", () => ({
  default: function ChatInterfaceStub() {
    useEffect(() => {
      chatLifecycle.mounts += 1;
      return () => {
        chatLifecycle.unmounts += 1;
      };
    }, []);
    return null;
  },
}));

const [setTextGenerationState] = textGenerationStatePubSub;
const [setIsRestoringFromHistory] = isRestoringFromHistoryPubSub;
const [setSettings] = settingsPubSub;
const defaultSettings = getSettings();

beforeEach(() => {
  chatLifecycle.mounts = 0;
  chatLifecycle.unmounts = 0;
  setSettings({ ...defaultSettings, enableAiResponse: true });
  setCurrentSearchRunId("first-search");
  setTextGenerationState("completed");
});

afterEach(() => {
  act(() => {
    setTextGenerationState("idle");
    setIsRestoringFromHistory(false);
    setSettings(defaultSettings);
  });
  resetSearchRunId();
});

function restore(searchRunId: string) {
  act(() => {
    setCurrentSearchRunId(searchRunId);
    setIsRestoringFromHistory(true);
  });
  act(() => setIsRestoringFromHistory(false));
}

describe("AiResponseSection", () => {
  it("remounts the chat when another search is restored", () => {
    render(<AiResponseSection />);
    expect(chatLifecycle.mounts).toBe(1);

    restore("second-search");

    expect(chatLifecycle.unmounts).toBe(1);
    expect(chatLifecycle.mounts).toBe(2);
  });

  it("keeps the chat mounted when the search on screen is restored", () => {
    render(<AiResponseSection />);

    restore("first-search");

    expect(chatLifecycle.unmounts).toBe(0);
    expect(chatLifecycle.mounts).toBe(1);
  });
});
