import { Box, TypographyStylesProvider, useMantineTheme } from "@mantine/core";
import React from "react";
import Markdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import syntaxHighlighterStyle from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import remarkGfm from "remark-gfm";
import CopyIconButton from "./CopyIconButton";

interface FormattedMarkdownProps {
  children: string;
  className?: string;
  enableCopy?: boolean;
}

const FormattedMarkdown: React.FC<FormattedMarkdownProps> = ({
  children,
  className = "",
  enableCopy = true,
}) => {
  const theme = useMantineTheme();

  if (!children) {
    return null;
  }

  return (
    <TypographyStylesProvider p="md">
      <Box className={className}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            li(props) {
              const { children } = props;
              const processedChildren = React.Children.map(
                children,
                (child) => {
                  if (React.isValidElement(child) && child.type === "p") {
                    return (child.props as { children: React.ReactNode })
                      .children;
                  }
                  return child;
                },
              );
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
          {children}
        </Markdown>
      </Box>
    </TypographyStylesProvider>
  );
};

export default FormattedMarkdown;
