import { CodeHighlight } from "@mantine/code-highlight";
import { Blockquote, Box, Code, Divider, Text } from "@mantine/core";
import React, { type ComponentProps, memo, useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
import Markdown from "react-markdown";
import rehypeExternalLinks from "rehype-external-links";
import remarkGfm from "remark-gfm";
import ExpandableLink from "./ExpandableLink";
import { splitMarkdownBlocks } from "./markdownBlocks";

interface MarkdownRendererProps {
  content: string;
  enableCopy?: boolean;
  className?: string;
}

// Hoisted so every block shares one plugin identity; a fresh array per
// render would rebuild the unified processor on every streamed frame.
const REMARK_PLUGINS: ComponentProps<typeof Markdown>["remarkPlugins"] = [
  remarkGfm,
];
const REHYPE_PLUGINS: ComponentProps<typeof Markdown>["rehypePlugins"] = [
  [
    rehypeExternalLinks,
    { target: "_blank", rel: ["nofollow", "noopener", "noreferrer"] },
  ],
];

const unwrapParagraphs = (children: React.ReactNode) => {
  return React.Children.map(children, (child) => {
    if (React.isValidElement(child) && child.type === "p") {
      return (child.props as { children: React.ReactNode }).children;
    }
    return child;
  });
};

interface MarkdownBlockProps {
  content: string;
  enableCopy: boolean;
}

/**
 * One top-level markdown block rendered through the full pipeline.
 *
 * Memoized on its props: while an answer streams, only the last block's
 * `content` changes per frame, so every earlier block skips its markdown
 * parse, syntax highlighting and DOM diff entirely.
 */
const MarkdownBlock = memo(function MarkdownBlock({
  content,
  enableCopy,
}: MarkdownBlockProps) {
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={{
        a(props) {
          const { href, children } = props;
          return <ExpandableLink href={href || ""}>{children}</ExpandableLink>;
        },
        li(props) {
          const { children } = props;
          return <li>{unwrapParagraphs(children)}</li>;
        },
        hr() {
          return <Divider variant="dashed" my="md" />;
        },
        pre(props) {
          return <>{props.children}</>;
        },
        blockquote(props) {
          const { children } = props;
          return (
            <Blockquote>
              <Text size="md">{unwrapParagraphs(children)}</Text>
            </Blockquote>
          );
        },
        code(props) {
          const { children, className, node } = props;
          const codeContent = children?.toString().replace(/\n$/, "") ?? "";
          let language = "text";

          if (className) {
            const languageMatch = /language-(\w+)/.exec(className);
            if (languageMatch) language = languageMatch[1];
          }

          if (
            language === "text" &&
            node?.position?.end.line === node?.position?.start.line
          ) {
            return <Code>{codeContent}</Code>;
          }

          return (
            <ErrorBoundary fallback={<Code block>{codeContent}</Code>}>
              <CodeHighlight
                code={codeContent}
                language={language}
                radius="md"
                withCopyButton={enableCopy}
                mb="xs"
              />
            </ErrorBoundary>
          );
        },
      }}
    >
      {content}
    </Markdown>
  );
});

/**
 * Renders markdown as a list of memoized top-level blocks (see
 * `splitMarkdownBlocks`). The block list is memoized on `content` so the
 * block strings — and therefore the memo props of every block but the
 * last — stay referentially stable across streamed frames.
 */
export default function MarkdownRenderer({
  content,
  enableCopy = true,
  className = "",
}: MarkdownRendererProps) {
  const blocks = useMemo(() => splitMarkdownBlocks(content), [content]);

  if (!content) {
    return null;
  }

  return (
    <Box className={className}>
      {blocks.map((block, index) => (
        // The index is a stable identity here: streaming only appends, so
        // prefix blocks keep their index and their memo hit. A content key
        // would change every frame for the growing last block and remount
        // it instead of re-rendering it.
        // biome-ignore lint/suspicious/noArrayIndexKey: append-only block list
        <MarkdownBlock key={index} content={block} enableCopy={enableCopy} />
      ))}
    </Box>
  );
}
