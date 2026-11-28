import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePubSub } from "create-pubsub/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAnswerFileName,
  buildAnswerMarkdown,
  downloadAnswerMarkdown,
} from "@/modules/answerExport";
import AiResponseContent from "./AiResponseContent";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn(),
}));

vi.mock("@/modules/answerExport", () => ({
  buildAnswerMarkdown: vi.fn(() => "exported markdown"),
  buildAnswerFileName: vi.fn(() => "mercury.md"),
  downloadAnswerMarkdown: vi.fn(),
}));

// Show the text each copy button would put on the clipboard.
vi.mock("./CopyIconButton", () => ({
  default: ({
    value,
    tooltipLabel,
  }: {
    value: string;
    tooltipLabel?: string;
  }) => <button type="button" aria-label={tooltipLabel} data-value={value} />,
}));

vi.mock("@/modules/textGeneration", () => ({
  interruptSearch: vi.fn(),
  searchAndRespond: vi.fn(),
}));

vi.mock("@/modules/textToSpeech", () => ({
  speak: vi.fn(),
}));

vi.mock("./FormattedMarkdown", () => ({
  default: ({
    children,
    isGenerating,
  }: {
    children: string;
    isGenerating?: boolean;
  }) => (
    <div
      data-testid="formatted-markdown"
      data-generating={String(Boolean(isGenerating))}
    >
      {children}
    </div>
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

  it.each([
    ["generating", "true"],
    ["interrupted", "false"],
    ["completed", "false"],
  ])(
    "tells the markdown whether the response is generating (%s)",
    (state, expected) => {
      renderContent(state);

      expect(screen.getByTestId("formatted-markdown")).toHaveAttribute(
        "data-generating",
        expected,
      );
    },
  );

  it("gives the toolbar action icons accessible names while generating", () => {
    renderContent("generating");
    expect(
      screen.getByRole("button", { name: "Interrupt generation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Listen to response" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enable scroll bar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy response" }),
    ).toBeInTheDocument();
  });

  it("gives the regenerate button an accessible name when completed", () => {
    renderContent("completed");
    expect(
      screen.getByRole("button", { name: "Regenerate response" }),
    ).toBeInTheDocument();
  });

  it("keeps copying the raw response and adds the export next to it", () => {
    renderContent("completed");

    expect(buildAnswerMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "Hello world" }),
    );
    expect(
      screen.getByRole("button", { name: "Copy response" }),
    ).toHaveAttribute("data-value", "Hello world");
    expect(
      screen.getByRole("button", { name: "Copy as Markdown" }),
    ).toHaveAttribute("data-value", "exported markdown");
  });

  it("downloads the built markdown under a name from the query", async () => {
    renderContent("completed");

    await userEvent.click(screen.getByRole("button", { name: "Download .md" }));

    expect(downloadAnswerMarkdown).toHaveBeenCalledWith(
      "exported markdown",
      "mercury.md",
    );
    expect(buildAnswerFileName).toHaveBeenCalledWith("");
  });
});
