import { CodeHighlight } from "@mantine/code-highlight";
import { Box, Button, Code } from "@mantine/core";
import React, { lazy } from "react";
import rehypeExternalLinks from "rehype-external-links";
import remarkGfm from "remark-gfm";

const Markdown = lazy(() => import("react-markdown"));
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
              <Button
                component="a"
                href={href}
                target="_blank"
                rel="nofollow noopener noreferrer"
                variant="light"
                color="gray"
                size="compact-xs"
                radius="xl"
                style={{
                  textDecoration: "none",
                  transform: "translateY(-2px)",
                }}
              >
                {children}
              </Button>
            );
          },
          li(props) {
            const { children } = props;
            const processedChildren = React.Children.map(children, (child) => {
              if (React.isValidElement(child) && child.type === "p") {
                return (child.props as { children: React.ReactNode }).children;
              }
              return child;
            });
            return <li>{processedChildren}</li>;
          },
          pre(props) {
            return <>{props.children}</>;
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
              <CodeHighlight
                code={codeContent}
                language={language}
                radius="md"
                withCopyButton={enableCopy}
                mb="xs"
              />
            );
          },
        }}
      >
        {content}
      </Markdown>
    </Box>
  );
}
