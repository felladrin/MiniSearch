import { Typography } from "@mantine/core";
import { useReasoningContent } from "./hooks/useReasoningContent";
import MarkdownRenderer from "./MarkdownRenderer";
import ReasoningSection from "./ReasoningSection";

interface FormattedMarkdownProps {
  children: string;
  className?: string;
  enableCopy?: boolean;
  "aria-live"?: string;
  "aria-busy"?: boolean;
}

export default function FormattedMarkdown({
  children,
  className = "",
  enableCopy = true,
  "aria-live": ariaLive,
  "aria-busy": ariaBusy,
}: FormattedMarkdownProps) {
  const { reasoningContent, mainContent, isGenerating } =
    useReasoningContent(children);

  if (!children && !reasoningContent) {
    return null;
  }

  return (
    <Typography p="lg" aria-live={ariaLive} aria-busy={ariaBusy}>
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
    </Typography>
  );
}
