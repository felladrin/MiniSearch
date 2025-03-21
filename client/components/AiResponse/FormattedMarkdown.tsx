import { TypographyStylesProvider } from "@mantine/core";
import { lazy } from "react";

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));
const ReasoningSection = lazy(() => import("./ReasoningSection"));

import { useReasoningContent } from "./hooks/useReasoningContent";

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
  if (!children) {
    return null;
  }

  const { reasoningContent, mainContent, isGenerating, thinkingTimeMs } =
    useReasoningContent(children);

  return (
    <TypographyStylesProvider p="lg">
      {reasoningContent && (
        <ReasoningSection
          content={reasoningContent}
          isGenerating={isGenerating}
          thinkingTimeMs={thinkingTimeMs}
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
