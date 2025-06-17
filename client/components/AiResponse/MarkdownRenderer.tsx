import { CodeHighlight } from "@mantine/code-highlight";
import { Box, Code, Divider } from "@mantine/core";
import React, { lazy } from "react";
import rehypeExternalLinks from "rehype-external-links";
import remarkGfm from "remark-gfm";
import ExpandableLink from "./ExpandableLink";

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
              <ExpandableLink href={href || ""}>{children}</ExpandableLink>
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
          hr() {
            return <Divider variant="dashed" my="md" />;
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
