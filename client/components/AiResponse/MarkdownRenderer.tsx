import { Box, Button, useMantineTheme } from "@mantine/core";
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
            void node;
            const languageMatch = /language-(\w+)/.exec(className || "");
            const codeContent = children?.toString().replace(/\n$/, "") ?? "";

            if (languageMatch) {
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
                    language={languageMatch[1]}
                    style={syntaxHighlighterStyle}
                  >
                    {codeContent}
                  </SyntaxHighlighter>
                </Box>
              );
            }

            return (
              <code
                {...rest}
                className={className}
                style={{
                  backgroundColor: theme.colors.gray[8],
                  padding: "0.2em 0.4em",
                  borderRadius: theme.radius.sm,
                  fontSize: "0.9em",
                }}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </Markdown>
    </Box>
  );
}
