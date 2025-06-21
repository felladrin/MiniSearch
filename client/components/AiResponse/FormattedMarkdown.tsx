import { TypographyStylesProvider } from "@mantine/core";
import { lazy } from "react";
import { useReasoningContent } from "./hooks/useReasoningContent";

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));
const ReasoningSection = lazy(() => import("./ReasoningSection"));

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
