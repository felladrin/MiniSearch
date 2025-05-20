import { Box, Button, Code, useMantineTheme } from "@mantine/core";
import React, { lazy } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import syntaxHighlighterStyle from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import rehypeExternalLinks from "rehype-external-links";
import remarkGfm from "remark-gfm";

const Markdown = lazy(() => import("react-markdown"));
const CopyIconButton = lazy(() => import("./CopyIconButton"));

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
  const theme = useMantineTheme();

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
            const { children, className, node, ref, ...rest } = props;
            let language = "text";
            if (className) {
              const languageMatch = /language-(\w+)/.exec(className);
              if (languageMatch) language = languageMatch[1];
            }
            const codeContent = children?.toString().replace(/\n$/, "") ?? "";

            if (node?.position?.end.line === node?.position?.start.line) {
              return <Code>{codeContent}</Code>;
            }

            return (
              <Box
                style={{
                  position: "relative",
                  marginBottom: theme.spacing.md,
                }}
              >
                {enableCopy && (
                  <Box
                    style={{
                      position: "absolute",
                      top: theme.spacing.xs,
                      right: theme.spacing.xs,
                      zIndex: 2,
                    }}
                  >
                    <CopyIconButton value={codeContent} />
                  </Box>
                )}
                <SyntaxHighlighter
                  {...rest}
                  ref={ref as never}
                  language={language}
                  style={syntaxHighlighterStyle}
                >
                  {codeContent}
                </SyntaxHighlighter>
              </Box>
            );
          },
        }}
      >
        {content}
      </Markdown>
    </Box>
  );
}
