import { Box, Group, Stack, Text, useComputedColorScheme } from "@mantine/core";
import { IconFlame } from "@tabler/icons-react";
import { type ActivityData, intensityLevel } from "@/modules/searchActivity";

interface ActivityHeatmapProps {
  data: ActivityData;
  compact?: boolean;
}

const WEEKDAYS = [
  { key: "sun", label: "" },
  { key: "mon", label: "Mon" },
  { key: "tue", label: "" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "" },
];

export default function ActivityHeatmap({
  data,
  compact = false,
}: ActivityHeatmapProps) {
  const scheme = useComputedColorScheme("light");
  const { columns, monthLabels, stats, maxCount, weeks } = data;

  const gap = compact ? 2 : 3;
  const labelWidth = compact ? 24 : 28;
  const labelSize = compact ? 10 : 11;

  const empty =
    scheme === "dark"
      ? "var(--mantine-color-dark-5)"
      : "var(--mantine-color-gray-2)";
  const ramp =
    scheme === "dark"
      ? [
          "var(--mantine-color-blue-9)",
          "var(--mantine-color-blue-7)",
          "var(--mantine-color-blue-5)",
          "var(--mantine-color-blue-4)",
        ]
      : [
          "var(--mantine-color-blue-2)",
          "var(--mantine-color-blue-4)",
          "var(--mantine-color-blue-6)",
          "var(--mantine-color-blue-8)",
        ];
  const colorFor = (level: number) => (level === 0 ? empty : ramp[level - 1]);

  return (
    <Stack gap={compact ? "xs" : "sm"}>
      <Group justify="space-between" align="baseline">
        <Group gap={compact ? "md" : "lg"}>
          <Stack gap={0}>
            <Group gap={4} align="center">
              {stats.currentStreak > 0 && (
                <IconFlame
                  size={compact ? 14 : 16}
                  color="var(--mantine-color-orange-6)"
                />
              )}
              <Text fw={700} size={compact ? "sm" : "md"}>
                {stats.currentStreak}d
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              Current streak
            </Text>
          </Stack>
          <Stack gap={0}>
            <Text fw={700} size={compact ? "sm" : "md"}>
              {stats.longestStreak}d
            </Text>
            <Text size="xs" c="dimmed">
              Longest
            </Text>
          </Stack>
          <Stack gap={0}>
            <Text fw={700} size={compact ? "sm" : "md"}>
              {stats.daysActive}
            </Text>
            <Text size="xs" c="dimmed">
              Active days
            </Text>
          </Stack>
        </Group>
        <Text size="xs" c="dimmed">
          Last {weeks} weeks
        </Text>
      </Group>

      <Box>
        <Group gap={gap} wrap="nowrap" mb={2} style={{ alignItems: "stretch" }}>
          <Box w={labelWidth} style={{ flexShrink: 0 }} />
          {columns.map((column, colIndex) => (
            <Text
              key={`month-${column[0]?.date ?? colIndex}`}
              fz={labelSize}
              c="dimmed"
              style={{
                flex: 1,
                whiteSpace: "nowrap",
                overflow: "visible",
              }}
            >
              {monthLabels[colIndex]}
            </Text>
          ))}
        </Group>

        <Group gap={gap} wrap="nowrap" style={{ alignItems: "stretch" }}>
          <Stack
            gap={gap}
            w={labelWidth}
            style={{ flexShrink: 0 }}
            justify="space-between"
          >
            {WEEKDAYS.map((weekday) => (
              <Text
                key={weekday.key}
                fz={labelSize}
                c="dimmed"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  lineHeight: 1,
                }}
              >
                {weekday.label}
              </Text>
            ))}
          </Stack>

          {columns.map((column, colIndex) => (
            <Stack
              key={`col-${column[0]?.date ?? colIndex}`}
              gap={gap}
              style={{ flex: 1 }}
            >
              {column.map((cell) => (
                <Box
                  key={cell.date}
                  title={
                    cell.future
                      ? undefined
                      : `${cell.date}: ${cell.count} ${
                          cell.count === 1 ? "search" : "searches"
                        }`
                  }
                  style={{
                    aspectRatio: "1 / 1",
                    borderRadius: 2,
                    backgroundColor: cell.future
                      ? "transparent"
                      : colorFor(intensityLevel(cell.count, maxCount)),
                  }}
                />
              ))}
            </Stack>
          ))}
        </Group>
      </Box>

      <Group gap={6} justify="flex-end" align="center">
        <Text size="xs" c="dimmed">
          Less
        </Text>
        {[0, 1, 2, 3, 4].map((level) => (
          <Box
            key={`legend-${level}`}
            w={compact ? 10 : 12}
            h={compact ? 10 : 12}
            style={{ borderRadius: 2, backgroundColor: colorFor(level) }}
          />
        ))}
        <Text size="xs" c="dimmed">
          More
        </Text>
      </Group>
    </Stack>
  );
}
