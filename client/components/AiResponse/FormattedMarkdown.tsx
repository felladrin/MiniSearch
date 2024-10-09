import { TypographyStylesProvider } from "@mantine/core";
import Markdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import syntaxHighlighterStyle from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";

const FormattedMarkdown = ({ children }: { children: string }) => {
  return (
    <TypographyStylesProvider p="md">
      <Markdown
        components={{
          code(props) {
            const { children, className, node, ref, ...rest } = props;
            void node;
            const languageMatch = /language-(\w+)/.exec(className || "");
            return languageMatch ? (
              <SyntaxHighlighter
                {...rest}
                ref={ref as never}
                children={children?.toString().replace(/\n$/, "") ?? ""}
                language={languageMatch[1]}
                style={syntaxHighlighterStyle}
              />
            ) : (
              <code {...rest} className={className}>
                {children}
              </code>
            );
          },
        }}
      >
        {children}
      </Markdown>
    </TypographyStylesProvider>
  );
};

export default FormattedMarkdown;
