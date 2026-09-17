import { MantineProvider } from "@mantine/core";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "./MarkdownRenderer";

// Stub the highlighter so the real markdown pipeline runs without loading
// Shiki; the stub exposes the props the code component derives.
vi.mock("@mantine/code-highlight", () => ({
  CodeHighlight: ({
    code,
    language,
    withCopyButton,
  }: {
    code: string;
    language?: string;
    withCopyButton?: boolean;
  }) => (
    <div
      data-testid="code-highlight"
      data-language={language ?? ""}
      data-copy={String(withCopyButton)}
    >
      {code}
    </div>
  ),
}));

function renderMarkdown(content: string, enableCopy?: boolean) {
  return render(
    <MantineProvider>
      <MarkdownRenderer content={content} enableCopy={enableCopy} />
    </MantineProvider>,
  );
}

describe("MarkdownRenderer rendered output", () => {
  it("renders nothing for empty content", () => {
    const { container } = renderMarkdown("");
    // MantineProvider injects <style> tags into the container; the
    // renderer itself contributes no Box root.
    expect(container.querySelector(".mantine-Box-root")).toBeNull();
  });

  it("renders paragraphs and unwraps paragraphs inside list items", () => {
    const { container } = renderMarkdown("- one\n\n- two");

    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    // unwrapParagraphs strips the <p> a loose list wraps each item in.
    for (const item of items) {
      expect(item.querySelector("p")).toBeNull();
      expect(item.textContent).toBeTruthy();
    }
  });

  it("renders a blockquote without inner paragraphs", () => {
    const { container } = renderMarkdown("> quoted text");

    const quote = container.querySelector(".mantine-Blockquote-root");
    expect(quote).not.toBeNull();
    // unwrapParagraphs strips the markdown <p>; the only <p> left is the
    // one Mantine's Text itself renders.
    expect(quote?.querySelector("p:not(.mantine-Text-root)")).toBeNull();
    expect(quote?.querySelector(".mantine-Text-root")).not.toBeNull();
  });

  it("renders a thematic break as a dashed Divider", () => {
    const { container } = renderMarkdown("before\n\n---\n\nafter");

    expect(container.querySelector(".mantine-Divider-root")).not.toBeNull();
  });

  it("renders links through ExpandableLink with external-link attributes", () => {
    const { container } = renderMarkdown("See [example](https://example.com).");

    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link?.getAttribute("rel")).toContain("nofollow");
  });

  it("renders a fenced code block through CodeHighlight with its language", () => {
    const { getByTestId } = renderMarkdown("```js\nconst x = 1;\n```");

    const highlight = getByTestId("code-highlight");
    expect(highlight).toHaveAttribute("data-language", "js");
    expect(highlight).toHaveAttribute("data-copy", "true");
    // The trailing newline is stripped, as before.
    expect(highlight.textContent).toBe("const x = 1;");
  });

  it("passes enableCopy=false through to the code block", () => {
    const { getByTestId } = renderMarkdown("```js\nconst x = 1;\n```", false);

    expect(getByTestId("code-highlight")).toHaveAttribute("data-copy", "false");
  });

  it("renders inline code as a Mantine Code element", () => {
    const { container } = renderMarkdown("text with `inline` code");

    const code = container.querySelector("code.mantine-Code-root");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("inline");
    expect(
      container.querySelector('[data-testid="code-highlight"]'),
    ).toBeNull();
  });

  it("renders multiple blocks as adjacent siblings in order", () => {
    const { container } = renderMarkdown(
      "# Heading\n\nA paragraph.\n\n- list\n\n> quote",
    );

    expect(container.querySelector("h1")?.textContent).toBe("Heading");
    expect(container.textContent).toContain("A paragraph.");
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.querySelector(".mantine-Blockquote-root")).not.toBeNull();
  });
});
