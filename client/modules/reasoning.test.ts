import { describe, expect, it } from "vitest";
import { splitReasoning } from "./reasoning";

describe("splitReasoning", () => {
  it("splits a terminated reasoning block from the answer", () => {
    expect(
      splitReasoning(
        "<think>Let me think about this</think>\nHere is the answer.",
        "<think>",
        "</think>",
      ),
    ).toEqual({
      reasoning: "Let me think about this",
      answer: "\nHere is the answer.",
      isOpen: false,
    });
  });

  it("treats an unterminated block as reasoning running to the end", () => {
    expect(
      splitReasoning("<think>still thinking", "<think>", "</think>"),
    ).toEqual({
      reasoning: "still thinking",
      answer: "",
      isOpen: true,
    });
  });

  it("leaves a marker mentioned mid-answer intact", () => {
    const text = "Models wrap reasoning in <think> tags like this.";
    expect(splitReasoning(text, "<think>", "</think>")).toEqual({
      reasoning: "",
      answer: text,
      isOpen: false,
    });
  });

  it("returns the text as answer when no start marker opens the response", () => {
    const text = "This is a normal response.";
    expect(splitReasoning(text, "<think>", "</think>")).toEqual({
      reasoning: "",
      answer: text,
      isOpen: false,
    });
  });

  it.each([
    ["empty text", ""],
    ["whitespace-only text", "   "],
  ])("reports nothing for %s", (_, text) => {
    expect(splitReasoning(text, "<think>", "</think>")).toEqual({
      reasoning: "",
      answer: text,
      isOpen: false,
    });
  });

  it("trims before checking the start marker, like the UI does", () => {
    expect(
      splitReasoning("  <think>quiet</think>loud", "<think>", "</think>"),
    ).toEqual({
      reasoning: "quiet",
      answer: "loud",
      isOpen: false,
    });
  });

  it("supports custom marker pairs", () => {
    expect(
      splitReasoning(
        "[REASONING]hmm[/REASONING]yes",
        "[REASONING]",
        "[/REASONING]",
      ),
    ).toEqual({
      reasoning: "hmm",
      answer: "yes",
      isOpen: false,
    });
  });
});
