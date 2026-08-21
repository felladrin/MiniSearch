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

    it.each([
      ["empty text", ""],
      ["whitespace-only text", "   "],
      ["no text at all", null as unknown as string],
    ])("should report nothing to show for %s", (_, content) => {
      const { result } = renderHook(() => useReasoningContent(content));
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
  });
});
