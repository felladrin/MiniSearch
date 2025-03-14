import {
  Box,
  Collapse,
  Flex,
  Group,
  Loader,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { lazy, useState } from "react";
import { formatThinkingTime } from "../../modules/stringFormatters";

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

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
        <Group gap={3}>
          {isOpen ? (
            <IconChevronDown size={16} />
          ) : (
            <IconChevronRight size={16} />
          )}
          <Flex align="center" gap={6}>
            <Text size="sm" c="dimmed" fs="italic" span>
              {isGenerating ? "Thinking" : formatThinkingTime(thinkingTimeMs)}
            </Text>
            {isGenerating && <Loader size="sm" color="dimmed" type="dots" />}
          </Flex>
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
          <MarkdownRenderer content={content} enableCopy={false} />
        </Box>
      </Collapse>
    </Box>
  );
}
