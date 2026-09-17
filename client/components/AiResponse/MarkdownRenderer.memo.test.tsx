import { MantineProvider } from "@mantine/core";
import { render } from "@testing-library/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "./MarkdownRenderer";

// Replace the parser with a counting stub: a block's render function calls
// Markdown exactly once, so the call log is a per-block render counter.
// If memo skips a block, its content never appears in a new call.
vi.mock("react-markdown", () => ({
  default: vi.fn(({ children }: { children: string }) => (
    <div data-testid="markdown-block">{children}</div>
  )),
}));

function renderCountFor(content: string): number {
  return vi
    .mocked(Markdown)
    .mock.calls.filter(
      (call) => (call[0] as { children: string }).children === content,
    ).length;
}

function totalRenderCount(): number {
  return vi.mocked(Markdown).mock.calls.length;
}

function renderRenderer(content: string) {
  return render(
    <MantineProvider>
      <MarkdownRenderer content={content} />
    </MantineProvider>,
  );
}

describe("MarkdownRenderer block memoization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-renders exactly one block when the last block grows", () => {
    const { rerender } = renderRenderer("Alpha.\n\nBeta.");
    expect(totalRenderCount()).toBe(2);

    rerender(
      <MantineProvider>
        <MarkdownRenderer content={"Alpha.\n\nBeta grew."} />
      </MantineProvider>,
    );

    // The unchanged prefix block did not render again; only the grown
    // last block did — one new render in total.
    expect(renderCountFor("Alpha.")).toBe(1);
    expect(renderCountFor("Beta grew.")).toBe(1);
    expect(totalRenderCount()).toBe(3);
  });

  it("does not re-render the unchanged prefix when a new block is appended", () => {
    const { rerender } = renderRenderer("A.\n\nB.");

    rerender(
      <MantineProvider>
        <MarkdownRenderer content={"A.\n\nB.\n\nC."} />
      </MantineProvider>,
    );

    expect(renderCountFor("A.")).toBe(1);
    expect(renderCountFor("B.")).toBe(1);
    expect(renderCountFor("C.")).toBe(1);
    expect(totalRenderCount()).toBe(3);
  });

  it("renders nothing new when the content is identical", () => {
    const { rerender } = renderRenderer("Same.\n\nContent.");
    const before = totalRenderCount();

    rerender(
      <MantineProvider>
        <MarkdownRenderer content={"Same.\n\nContent."} />
      </MantineProvider>,
    );

    expect(totalRenderCount()).toBe(before);
  });

  it("keeps earlier blocks stable across a streamed append sequence", () => {
    const chunks = [
      "Intro.\n\n",
      "Intro.\n\nFirst se",
      "Intro.\n\nFirst sentence.\n\nSec",
      "Intro.\n\nFirst sentence.\n\nSecond sentence.\n\n```\nc",
      "Intro.\n\nFirst sentence.\n\nSecond sentence.\n\n```\ncode\n```",
    ];

    const { rerender } = renderRenderer(chunks[0]);
    for (const chunk of chunks.slice(1)) {
      rerender(
        <MantineProvider>
          <MarkdownRenderer content={chunk} />
        </MantineProvider>,
      );
    }

    // The first block rendered once at the start and was never touched
    // again, no matter how much arrived after it.
    expect(renderCountFor("Intro.")).toBe(1);
  });

  it("passes the same plugins and components pipeline to every block", () => {
    renderRenderer("X.\n\nY.");

    expect(totalRenderCount()).toBe(2);
    for (const [props] of vi.mocked(Markdown).mock.calls) {
      const typed = props as {
        remarkPlugins: unknown[];
        rehypePlugins: unknown;
        components: Record<string, unknown>;
      };
      expect(typed.remarkPlugins).toContain(remarkGfm);
      expect(typed.rehypePlugins).toBeDefined();
      expect(typed.components).toHaveProperty("a");
      expect(typed.components).toHaveProperty("li");
      expect(typed.components).toHaveProperty("hr");
      expect(typed.components).toHaveProperty("pre");
      expect(typed.components).toHaveProperty("blockquote");
      expect(typed.components).toHaveProperty("code");
    }
  });
});
