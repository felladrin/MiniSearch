import { describe, expect, it } from "vitest";
import { splitMarkdownBlocks } from "./markdownBlocks";

describe("splitMarkdownBlocks", () => {
  it("splits top-level paragraphs at blank lines", () => {
    expect(splitMarkdownBlocks("First.\n\nSecond.\n\nThird.")).toEqual([
      "First.",
      "Second.",
      "Third.",
    ]);
  });

  it("collapses a run of blank lines into a single boundary", () => {
    expect(splitMarkdownBlocks("A\n\n\n\nB")).toEqual(["A", "B"]);
  });

  it("drops leading and trailing blank lines", () => {
    expect(splitMarkdownBlocks("\n  \nHello\n\n  \n")).toEqual(["Hello"]);
  });

  it("returns no blocks for whitespace-only input", () => {
    expect(splitMarkdownBlocks("   \n\t\n")).toEqual([]);
  });

  it("keeps a backtick-fenced code block with internal blank lines in one block", () => {
    const md = "Intro.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nOutro.";
    expect(splitMarkdownBlocks(md)).toEqual([
      "Intro.",
      "```js\nconst a = 1;\n\nconst b = 2;\n```",
      "Outro.",
    ]);
  });

  it("keeps a tilde-fenced code block with internal blank lines in one block", () => {
    const md = "~~~python\ndef f():\n    pass\n\n    return 1\n~~~\n\nAfter.";
    expect(splitMarkdownBlocks(md)).toEqual([
      "~~~python\ndef f():\n    pass\n\n    return 1\n~~~",
      "After.",
    ]);
  });

  it("closes a fence only on a run of the same character at least as long", () => {
    // The fourth backtick line closes the three-backtick fence; the text
    // after it is a new block again.
    const md = "```\ncode\n````\n\nAfter.";
    expect(splitMarkdownBlocks(md)).toEqual(["```\ncode\n````", "After."]);
  });

  it("does not close a fence on a line with trailing content", () => {
    // "``` not a close" is still inside the fence; the real close follows.
    const md = "```\na\n``` not a close\nb\n```\n\nAfter.";
    expect(splitMarkdownBlocks(md)).toEqual([
      "```\na\n``` not a close\nb\n```",
      "After.",
    ]);
  });

  it("keeps everything after an unterminated fence in one block", () => {
    const md = "Before.\n\n```python\ndef f():\n    pass\n\nstill code";
    expect(splitMarkdownBlocks(md)).toEqual([
      "Before.",
      "```python\ndef f():\n    pass\n\nstill code",
    ]);
  });

  it("keeps a loose list in one block", () => {
    expect(splitMarkdownBlocks("- one\n\n- two\n\n- three")).toEqual([
      "- one\n\n- two\n\n- three",
    ]);
  });

  it("keeps ordered list items in one block", () => {
    expect(splitMarkdownBlocks("1. one\n\n2. two")).toEqual([
      "1. one\n\n2. two",
    ]);
  });

  it("keeps a list that interrupts a paragraph in the same block as its items", () => {
    expect(splitMarkdownBlocks("para\n- a\n\n- b")).toEqual([
      "para\n- a\n\n- b",
    ]);
  });

  it("splits a list from a following non-indented paragraph", () => {
    expect(splitMarkdownBlocks("- one\n\nplain paragraph")).toEqual([
      "- one",
      "plain paragraph",
    ]);
  });

  it("keeps an indented continuation with the block it follows", () => {
    expect(splitMarkdownBlocks("- one\n\n  continued item body")).toEqual([
      "- one\n\n  continued item body",
    ]);
    expect(splitMarkdownBlocks("para\n\n    indented code")).toEqual([
      "para\n\n    indented code",
    ]);
  });

  it("splits blockquotes separated by a blank line", () => {
    // CommonMark renders these as two blockquotes, so two blocks match.
    expect(splitMarkdownBlocks("> one\n\n> two")).toEqual(["> one", "> two"]);
  });

  it("keeps a fence inside a list item in the list block", () => {
    const md = "- step\n\n  ```sh\n  echo hi\n\n  echo bye\n  ```\n\n- next";
    expect(splitMarkdownBlocks(md)).toEqual([md]);
  });

  it("splits headings and thematic breaks as their own blocks", () => {
    expect(splitMarkdownBlocks("# Heading\n\ntext\n\n---\n\nmore")).toEqual([
      "# Heading",
      "text",
      "---",
      "more",
    ]);
  });

  it("treats a thematic break as a list continuation only when it is one", () => {
    // "---" is a thematic break, not a list marker, so it does not keep a
    // non-list block open.
    expect(splitMarkdownBlocks("text\n\n---")).toEqual(["text", "---"]);
  });
});
