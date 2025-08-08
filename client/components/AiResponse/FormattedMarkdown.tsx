import { TypographyStylesProvider } from "@mantine/core";
import { useReasoningContent } from "./hooks/useReasoningContent";
import MarkdownRenderer from "./MarkdownRenderer";
import ReasoningSection from "./ReasoningSection";

interface FormattedMarkdownProps {
  children: string;
  className?: string;
  enableCopy?: boolean;
}

export default function FormattedMarkdown({
  children,
  className = "",
  enableCopy = true,
}: FormattedMarkdownProps) {
  const { reasoningContent, mainContent, isGenerating } =
    useReasoningContent(children);

  if (!children) {
    return null;
  }

  return (
    <TypographyStylesProvider p="lg">
      {reasoningContent && (
        <ReasoningSection
          content={reasoningContent}
          isGenerating={isGenerating}
        />
      )}
      {!isGenerating && mainContent && (
        <MarkdownRenderer
          content={mainContent}
          enableCopy={enableCopy}
          className={className}
        />
      )}
    </TypographyStylesProvider>
  );
}
