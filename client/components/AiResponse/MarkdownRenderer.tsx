import { CodeHighlight } from "@mantine/code-highlight";
import { Blockquote, Box, Code, Divider, Text } from "@mantine/core";
import React from "react";
import { ErrorBoundary } from "react-error-boundary";
import Markdown from "react-markdown";
import rehypeExternalLinks from "rehype-external-links";
import remarkGfm from "remark-gfm";
import ExpandableLink from "./ExpandableLink";

interface MarkdownRendererProps {
  content: string;
  enableCopy?: boolean;
  className?: string;
}

export default function MarkdownRenderer({
  content,
  enableCopy = true,
  className = "",
}: MarkdownRendererProps) {
  if (!content) {
    return null;
  }

  const unwrapParagraphs = (children: React.ReactNode) => {
    return React.Children.map(children, (child) => {
      if (React.isValidElement(child) && child.type === "p") {
        return (child.props as { children: React.ReactNode }).children;
      }
      return child;
    });
  };

  return (
    <Box className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [
            rehypeExternalLinks,
            { target: "_blank", rel: ["nofollow", "noopener", "noreferrer"] },
          ],
        ]}
        components={{
          a(props) {
            const { href, children } = props;
            return (
              <ExpandableLink href={href || ""}>{children}</ExpandableLink>
            );
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
    </Box>
  );
}
