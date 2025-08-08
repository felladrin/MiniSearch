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
import { useState } from "react";
import MarkdownRenderer from "./MarkdownRenderer";

interface ReasoningSectionProps {
  content: string;
  isGenerating?: boolean;
}

export default function ReasoningSection({
  content,
  isGenerating = false,
}: ReasoningSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Box mb="xs">
      <UnstyledButton
        onClick={() => setIsOpen(!isOpen)}
        style={(theme) => ({
          width: "100%",
          padding: theme.spacing.xs,
          borderStartStartRadius: theme.radius.md,
          borderStartEndRadius: theme.radius.md,
          borderEndEndRadius: !isOpen ? theme.radius.md : 0,
          borderEndStartRadius: !isOpen ? theme.radius.md : 0,
          backgroundColor: theme.colors.dark[8],
          "&:hover": {
            backgroundColor: theme.colors.dark[5],
          },
          cursor: isOpen ? "zoom-out" : "zoom-in",
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
              {isGenerating ? "Thinking" : "Thought Process"}
            </Text>
            {isGenerating && <Loader size="sm" color="dimmed" type="dots" />}
          </Flex>
        </Group>
      </UnstyledButton>
      <Collapse in={isOpen}>
        <Box
          style={(theme) => ({
            backgroundColor: theme.colors.dark[8],
            padding: theme.spacing.sm,
            borderBottomLeftRadius: theme.radius.md,
            borderBottomRightRadius: theme.radius.md,
          })}
        >
          <MarkdownRenderer content={content} enableCopy={false} />
        </Box>
      </Collapse>
    </Box>
  );
}
