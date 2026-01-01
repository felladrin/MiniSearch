import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useReasoningContent } from "./useReasoningContent";

describe("useReasoningContent hook", () => {
  describe("external reasoning content flow", () => {
    it("should detect generating state when externalReasoningContent is provided but main content is empty", () => {
      const { result } = renderHook(() =>
        useReasoningContent("", "Thinking about the query..."),
      );

      expect(result.current.reasoningContent).toBe(
        "Thinking about the query...",
      );
      expect(result.current.mainContent).toBe("");
      expect(result.current.isGenerating).toBe(true);
    });

    it("should detect non-generating state when both externalReasoningContent and main content are provided", () => {
      const { result } = renderHook(() =>
        useReasoningContent(
          "Here is the actual response.",
          "Thinking about the query...",
        ),
      );

      expect(result.current.reasoningContent).toBe(
        "Thinking about the query...",
      );
      expect(result.current.mainContent).toBe("Here is the actual response.");
      expect(result.current.isGenerating).toBe(false);
    });

    it("should handle partial streaming where reasoning content is being built", () => {
      const { result } = renderHook(() =>
        useReasoningContent("", "Step 1: Analyzing the query"),
      );

      expect(result.current.reasoningContent).toBe(
        "Step 1: Analyzing the query",
      );
      expect(result.current.mainContent).toBe("");
      expect(result.current.isGenerating).toBe(true);
    });

    it("should handle complete streaming where reasoning is finished and main content starts", () => {
      const { result } = renderHook(() =>
        useReasoningContent(
          "Now providing the actual answer.",
          "Analysis complete.",
        ),
      );

      expect(result.current.reasoningContent).toBe("Analysis complete.");
      expect(result.current.mainContent).toBe(
        "Now providing the actual answer.",
      );
      expect(result.current.isGenerating).toBe(false);
    });
  });

  describe("internal reasoning content flow (markdown markers)", () => {
    it("should handle cases without externalReasoningContent (fallback to internal parsing)", () => {
      const { result } = renderHook(() =>
        useReasoningContent("Some text content", ""),
      );

      expect(result.current.reasoningContent).toBe("");
      expect(result.current.mainContent).toBe("Some text content");
      expect(result.current.isGenerating).toBe(false);
    });

    it("should handle empty text when no externalReasoningContent is provided", () => {
      const { result } = renderHook(() => useReasoningContent("", ""));

      expect(result.current.reasoningContent).toBe("");
      expect(result.current.mainContent).toBe("");
      expect(result.current.isGenerating).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should return empty state when no content is provided", () => {
      const { result } = renderHook(() => useReasoningContent("", ""));

      expect(result.current.reasoningContent).toBe("");
      expect(result.current.mainContent).toBe("");
      expect(result.current.isGenerating).toBe(false);
    });

    it("should handle whitespace-only content", () => {
      const { result } = renderHook(() => useReasoningContent("   ", ""));

      expect(result.current.reasoningContent).toBe("");
      expect(result.current.mainContent).toBe("");
      expect(result.current.isGenerating).toBe(false);
    });

    it("should handle null/undefined content gracefully", () => {
      const { result } = renderHook(() =>
        useReasoningContent(
          null as unknown as string,
          null as unknown as string,
        ),
      );

      expect(result.current.reasoningContent).toBe("");
      expect(result.current.mainContent).toBe("");
      expect(result.current.isGenerating).toBe(false);
    });
  });

  describe("settings integration", () => {
    it("should handle cases when settings are not available", () => {
      const { result } = renderHook(() => useReasoningContent("Some text", ""));

      expect(result.current.reasoningContent).toBe("");
      expect(result.current.mainContent).toBe("Some text");
      expect(result.current.isGenerating).toBe(false);
    });
  });

  describe("UI state management for accordion", () => {
    it("should provide correct isGenerating state for accordion title changes", () => {
      const streamingState = renderHook(() =>
        useReasoningContent("", "Currently thinking..."),
      );

      expect(streamingState.result.current.isGenerating).toBe(true);

      const completedState = renderHook(() =>
        useReasoningContent(
          "Here is the answer.",
          "Thought process completed.",
        ),
      );

      expect(completedState.result.current.isGenerating).toBe(false);
    });

    it("should handle the transition from streaming to completed state", () => {
      const initial = renderHook(() =>
        useReasoningContent("", "Building response..."),
      );
      expect(initial.result.current.isGenerating).toBe(true);

      const transitioned = renderHook(() =>
        useReasoningContent("Final answer here.", "Response built."),
      );
      expect(transitioned.result.current.isGenerating).toBe(false);
    });
  });
});

describe("Reasoning content integration scenarios", () => {
  it("should correctly handle OpenAI streaming response with reasoning_content field", () => {
    const apiResponse = {
      content: "Here is your answer.",
      reasoning_content: "I analyzed the query and found...",
    };

    const { result } = renderHook(() =>
      useReasoningContent(apiResponse.content, apiResponse.reasoning_content),
    );

    expect(result.current.isGenerating).toBe(false);
    expect(result.current.reasoningContent).toBe(
      "I analyzed the query and found...",
    );
  });

  it("should correctly handle partial streaming response", () => {
    const partialResponse = {
      content: "", // Still streaming
      reasoning_content: "Currently processing...",
    };

    const { result } = renderHook(() =>
      useReasoningContent(
        partialResponse.content,
        partialResponse.reasoning_content,
      ),
    );

    expect(result.current.isGenerating).toBe(true);
    expect(result.current.reasoningContent).toBe("Currently processing...");
  });

  it("should handle transition from reasoning to main content in real-time", () => {
    const phase1 = renderHook(() =>
      useReasoningContent("", "Analyzing your query..."),
    );
    expect(phase1.result.current.isGenerating).toBe(true);

    const phase2 = renderHook(() =>
      useReasoningContent("Here is the answer.", "Analysis complete."),
    );
    expect(phase2.result.current.isGenerating).toBe(false);
  });
});
