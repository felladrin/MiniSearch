import { Box, Collapse, Group, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import { formatThinkingTime } from "../../modules/stringFormatters";
import FormattedMarkdown from "./FormattedMarkdown";

interface ReasoningSectionProps {
  content: string;
  isGenerating?: boolean;
  thinkingTimeMs?: number;
}

export default function ReasoningSection({
  content,
  isGenerating = false,
  thinkingTimeMs = 0,
}: ReasoningSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  const buttonText = isGenerating
    ? "Thinking..."
    : formatThinkingTime(thinkingTimeMs);

  return (
    <Box mb="md">
      <UnstyledButton
        onClick={() => setIsOpen(!isOpen)}
        style={(theme) => ({
          width: "100%",
          padding: theme.spacing.xs,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.dark[6],
          "&:hover": {
            backgroundColor: theme.colors.dark[5],
          },
        })}
      >
        <Group>
          {isOpen ? (
            <IconChevronDown size={16} />
          ) : (
            <IconChevronRight size={16} />
          )}
          <Text size="sm" c="dimmed" fs="italic">
            {buttonText}
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse in={isOpen}>
        <Box
          style={(theme) => ({
            backgroundColor: theme.colors.dark[7],
            padding: theme.spacing.sm,
            marginTop: theme.spacing.xs,
            borderRadius: theme.radius.sm,
          })}
        >
          <FormattedMarkdown enableCopy={false}>{content}</FormattedMarkdown>
        </Box>
      </Collapse>
    </Box>
  );
}
