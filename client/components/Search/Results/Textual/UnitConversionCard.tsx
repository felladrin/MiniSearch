import { Group, Paper, Text } from "@mantine/core";
import { IconArrowsExchange } from "@tabler/icons-react";

/**
 * The value SearXNG's own unit converter plugin worked out for the query, shown
 * above the results it came with. The value is text from upstream and is
 * rendered as text, so nothing it carries can be read as markup.
 */
export default function UnitConversionCard({ value }: { value: string }) {
  return (
    <Paper withBorder radius="sm" p="sm" mb="sm">
      <Group gap="sm">
        <IconArrowsExchange size={18} aria-hidden />
        <div>
          <Text size="xs" c="dimmed" fw={600}>
            Unit conversion
          </Text>
          <Text size="sm">{value}</Text>
        </div>
      </Group>
    </Paper>
  );
}
