import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { usePubSub } from "create-pubsub/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiResponseContent from "./AiResponseContent";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn(),
}));

vi.mock("@/modules/textGeneration", () => ({
  searchAndRespond: vi.fn(),
}));

vi.mock("@/modules/textToSpeech", () => ({
  speak: vi.fn(),
}));

vi.mock("./FormattedMarkdown", () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="formatted-markdown">{children}</div>
  ),
}));

function renderContent(textGenerationState: string) {
  vi.mocked(usePubSub)
    .mockReturnValueOnce([{ enableAiResponseScrolling: false }, vi.fn()])
    .mockReturnValueOnce(["idle", vi.fn()]);

  return render(
    <MantineProvider>
      <AiResponseContent
        textGenerationState={textGenerationState}
        response="Hello world"
        setTextGenerationState={vi.fn()}
      />
    </MantineProvider>,
  );
}

describe("AiResponseContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps the response body in a polite live region", () => {
    renderContent("generating");

    const liveRegion = screen
      .getByTestId("formatted-markdown")
      .closest("[aria-live]");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
  });

  it("marks the live region busy while generating", () => {
    renderContent("generating");

    const liveRegion = screen
      .getByTestId("formatted-markdown")
      .closest("[aria-live]");
    expect(liveRegion).toHaveAttribute("aria-busy", "true");
  });

  it("clears the busy flag once generation is no longer in progress", () => {
    renderContent("completed");

    const liveRegion = screen
      .getByTestId("formatted-markdown")
      .closest("[aria-live]");
    expect(liveRegion).toHaveAttribute("aria-busy", "false");
  });
});
