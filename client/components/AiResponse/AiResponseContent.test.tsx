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

const liveSources = vi.hoisted(() => ({
  current: [["Mercury - Wikipedia", "snippet", "https://en.wikipedia.org"]] as [
    string,
    string,
    string,
  ][],
}));

vi.mock("@/modules/pubSub", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/pubSub")>()),
  getQuery: vi.fn(() => "mercury"),
  getLlmTextSearchResults: vi.fn(() => liveSources.current),
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

const settings = {
  enableAiResponseScrolling: false,
  reasoningStartMarker: "<think>",
  reasoningEndMarker: "</think>",
};

function renderContent(
  textGenerationState: string,
  response = "Hello world",
  generationRate?: string,
) {
  // Each render reads the settings, the speech state, then the speed.
  let call = 0;
  vi.mocked(usePubSub).mockImplementation(() => {
    const slot = call++ % 3;
    if (slot === 0) return [settings, vi.fn()];
    if (slot === 1) return ["idle", vi.fn()];
    return [generationRate, vi.fn()];
  });

  const ui = (state: string) => (
    <MantineProvider>
      <AiResponseContent textGenerationState={state} response={response} />
    </MantineProvider>
  );
  const result = render(ui(textGenerationState));
  return {
    ...result,
    rerenderWith: (state: string) => result.rerender(ui(state)),
  };
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

    await userEvent.click(
      screen.getByRole("button", { name: "Download as Markdown" }),
    );

    expect(downloadAnswerMarkdown).toHaveBeenCalledWith(
      "exported markdown",
      "mercury.md",
    );
    expect(buildAnswerFileName).toHaveBeenCalledWith("mercury");
  });

  it("exports the answer without its reasoning", () => {
    renderContent("completed", "<think>Let me check.</think>Mercury is small.");

    expect(buildAnswerMarkdown).toHaveBeenLastCalledWith(
      expect.objectContaining({ answer: "Mercury is small." }),
    );
  });

  it("keeps the sources the answer finished with after a follow-up replaces them", () => {
    const { rerenderWith } = renderContent("completed");
    liveSources.current = [
      ["Follow-up result", "snippet", "https://other.org"],
    ];
    rerenderWith("completed");

    expect(buildAnswerMarkdown).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sources: [
          ["Mercury - Wikipedia", "snippet", "https://en.wikipedia.org"],
        ],
      }),
    );
    liveSources.current = [
      ["Mercury - Wikipedia", "snippet", "https://en.wikipedia.org"],
    ];
  });

  it("strips the prompt's image tag from a source title", () => {
    liveSources.current = [["(image) A diagram", "", "https://example.com/d"]];
    renderContent("completed");

    expect(buildAnswerMarkdown).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sources: [["A diagram", "", "https://example.com/d"]],
      }),
    );
    liveSources.current = [
      ["Mercury - Wikipedia", "snippet", "https://en.wikipedia.org"],
    ];
  });

  it("offers the export only once the answer is complete", () => {
    renderContent("generating");

    expect(
      screen.queryByRole("button", { name: "Copy as Markdown" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download as Markdown" }),
    ).not.toBeInTheDocument();
  });

  it("shows the generation speed once it is known", () => {
    renderContent("completed", "Hello world", "42 tokens/s");

    expect(screen.getByText("42 tokens/s")).toBeInTheDocument();
  });

  it("shows no generation speed while the answer is still generating", () => {
    renderContent("generating", "Hello world", "42 tokens/s");

    expect(screen.queryByText("42 tokens/s")).not.toBeInTheDocument();
  });

  it("shows no generation speed when none is known", () => {
    renderContent("completed");

    expect(screen.queryByText(/tokens\/s/)).not.toBeInTheDocument();
  });
});
