import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useReasoningContent } from "./useReasoningContent";

const expectEmptyState = (result: {
  current: ReturnType<typeof useReasoningContent>;
}) => {
  expect(result.current.reasoningContent).toBe("");
  expect(result.current.mainContent).toBe("");
  expect(result.current.isGenerating).toBe(false);
};

describe("useReasoningContent hook", () => {
  describe("parsing reasoning content from markdown markers", () => {
    it("should extract reasoning content between start and end markers", () => {
      const { result } = renderHook(() =>
        useReasoningContent(
          "<think>Let me think about this</think>\nHere is the answer.",
        ),
      );

      expect(result.current.reasoningContent).toBe("Let me think about this");
      expect(result.current.mainContent).toBe("\nHere is the answer.");
      expect(result.current.isGenerating).toBe(false);
    });

    it("should handle empty text", () => {
      const { result } = renderHook(() => useReasoningContent(""));
      expectEmptyState(result);
    });

    it("should return text as main content when no markers present", () => {
      const { result } = renderHook(() =>
        useReasoningContent("This is a normal response."),
      );

      expect(result.current.reasoningContent).toBe("");
      expect(result.current.mainContent).toBe("This is a normal response.");
      expect(result.current.isGenerating).toBe(false);
    });

    it("should detect generating state when end marker is missing", () => {
      const { result } = renderHook(() =>
        useReasoningContent("<think>I'm still thinking"),
      );

      expect(result.current.reasoningContent).toBe("I'm still thinking");
      expect(result.current.mainContent).toBe("");
      expect(result.current.isGenerating).toBe(true);
    });

    it("should handle whitespace-only content", () => {
      const { result } = renderHook(() => useReasoningContent("   "));
      expectEmptyState(result);
    });

    it("should handle null/undefined content gracefully", () => {
      const { result } = renderHook(() =>
        useReasoningContent(null as unknown as string),
      );
      expectEmptyState(result);
    });
  });

  describe("UI state management for reasoning section", () => {
    it("should provide correct isGenerating state for accordion title", () => {
      const streamingState = renderHook(() =>
        useReasoningContent("<think>Currently thinking..."),
      );

      expect(streamingState.result.current.isGenerating).toBe(true);

      const completedState = renderHook(() =>
        useReasoningContent(
          "<think>Thought process completed</think>\nHere is the answer.",
        ),
      );

      expect(completedState.result.current.isGenerating).toBe(false);
    });

    it("should handle transition from streaming to completed state", () => {
      const initial = renderHook(() =>
        useReasoningContent("<think>Building response..."),
      );
      expect(initial.result.current.isGenerating).toBe(true);

      const transitioned = renderHook(() =>
        useReasoningContent(
          "<think>Response built.</think>\nFinal answer here.",
        ),
      );
      expect(transitioned.result.current.isGenerating).toBe(false);
    });
  });
});
