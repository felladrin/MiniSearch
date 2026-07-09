import {
  Badge,
  Card,
  Center,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useMemo } from "react";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import type { SearchEntry } from "@/modules/history";
import { buildActivity } from "@/modules/searchActivity";
import { formatRelativeTime } from "@/modules/stringFormatters";
import ActivityHeatmap from "./ActivityHeatmap";

interface SearchStatsProps {
  period?: "today" | "week" | "month" | "all";
  compact?: boolean;
}

interface StatsData {
  totalSearches: number;
  avgPerDay: number;
  mostActiveHour: number;
  topSources: { source: string; count: number; percentage: number }[];
  recentActivity: SearchEntry[];
}

export default function SearchStats({
  period = "week",
  compact = false,
}: SearchStatsProps) {
  const { recentSearches, isLoading } = useSearchHistory({ limit: 1000 });

  const stats = useMemo((): StatsData => {
    if (!recentSearches.length) {
      return {
        totalSearches: 0,
        avgPerDay: 0,
        mostActiveHour: 0,
        topSources: [],
        recentActivity: [],
      };
    }

    const now = new Date();
    const filterDate = new Date();

    switch (period) {
      case "today":
        filterDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        filterDate.setDate(now.getDate() - 7);
        break;
      case "month":
        filterDate.setDate(now.getDate() - 30);
        break;
      default:
        filterDate.setFullYear(2000);
    }

    const filteredSearches = recentSearches.filter(
      (search) => search.timestamp >= filterDate.getTime(),
    );

    const totalSearches = filteredSearches.length;

    const dateCounts = new Map<string, number>();
    filteredSearches.forEach((search) => {
      const date = new Date(search.timestamp).toISOString().split("T")[0];
      dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
    });

    const uniqueDays = dateCounts.size;
    const avgPerDay =
      uniqueDays > 0 ? Math.round(totalSearches / uniqueDays) : 0;

    const hourCounts = new Array(24).fill(0);
    filteredSearches.forEach((search) => {
      const hour = new Date(search.timestamp).getHours();
      hourCounts[hour]++;
    });
    const mostActiveHour = hourCounts.indexOf(Math.max(...hourCounts));

    const sourceCounts = filteredSearches.reduce(
      (acc, search) => {
        if (compact && search.source?.toLowerCase() === "user") {
          return acc;
        }
        const source = search.source || "unknown";
        acc[source] = (acc[source] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const sourcesTotal = Object.values(sourceCounts).reduce(
      (sum, n) => sum + n,
      0,
    );
    const topSources = Object.entries(sourceCounts)
      .map(([source, count]) => ({
        source: source.charAt(0).toUpperCase() + source.slice(1),
        count,
        percentage:
          sourcesTotal > 0 ? Math.round((count / sourcesTotal) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const recentActivity = filteredSearches
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    return {
      totalSearches,
      avgPerDay,
      mostActiveHour,
      topSources,
      recentActivity,
    };
  }, [recentSearches, period, compact]);

  const activity = useMemo(
    () => buildActivity(recentSearches.map((search) => search.timestamp)),
    [recentSearches],
  );

  const getSourceColor = (source: string) => {
    const colors = {
      User: "blue",
      Followup: "green",
      Suggestion: "orange",
      Unknown: "gray",
    };
    return colors[source as keyof typeof colors] || "gray";
  };

  const formatHour = (hour: number) => {
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:00 ${period}`;
  };

  if (isLoading) {
    return (
      <Card withBorder>
        <Center h={200}>
          <Text c="dimmed">Loading analytics...</Text>
        </Center>
      </Card>
    );
  }

  if (stats.totalSearches === 0) {
    return (
      <Card withBorder>
        <Center h={200}>
          <Stack align="center" gap="xs">
            <ThemeIcon size="xl" variant="light" color="gray">
              <IconSearch size={24} />
            </ThemeIcon>
            <Text c="dimmed">No search data available</Text>
            <Text size="sm" c="dimmed">
              Start searching to see analytics
            </Text>
          </Stack>
        </Center>
      </Card>
    );
  }

  function MetricCard({
    title,
    value,
  }: {
    title: string;
    value: string | number;
  }) {
    return (
      <Card withBorder p={compact ? "sm" : "md"}>
        <Stack gap="xs" align="flex-start">
          <Text size="xs" tt="uppercase" fw={700} c="dimmed">
            {title}
          </Text>
          <Text fw={700} size={compact ? "lg" : "xl"}>
            {value}
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap={compact ? "sm" : "md"}>
      <SimpleGrid cols={compact ? 2 : { base: 1, sm: 2, lg: 4 }}>
        <MetricCard
          title="Total Searches"
          value={stats.totalSearches.toLocaleString()}
        />
        <MetricCard title="Daily Average" value={stats.avgPerDay} />
        <MetricCard
          title="Most Active Hour"
          value={formatHour(stats.mostActiveHour)}
        />
        <MetricCard
          title="Last Search"
          value={
            stats.recentActivity.length > 0
              ? formatRelativeTime(stats.recentActivity[0].timestamp)
              : "Never"
          }
        />
      </SimpleGrid>

      <SimpleGrid cols={compact ? 1 : { base: 1, md: 2 }}>
        {!(compact && stats.topSources.length === 0) && (
          <Card withBorder>
            <Card.Section p={compact ? "sm" : "md"}>
              <Title order={compact ? 5 : 4} mb={compact ? "xs" : "md"}>
                Search Sources
              </Title>

              {stats.topSources.length > 0 ? (
                <Stack gap="xs">
                  {stats.topSources.map((source) => (
                    <Group key={source.source} justify="space-between">
                      <Group gap="xs">
                        <Badge
                          color={getSourceColor(source.source)}
                          variant="dot"
                          size="sm"
                        >
                          {source.source}
                        </Badge>
                        <Text size={compact ? "xs" : "sm"}>
                          {source.count} searches
                        </Text>
                      </Group>

                      <Group gap="xs">
                        <Progress
                          value={source.percentage}
                          size="sm"
                          w={compact ? 40 : 60}
                          color={getSourceColor(source.source)}
                        />
                        <Text size="xs" c="dimmed" w={30}>
                          {source.percentage}%
                        </Text>
                      </Group>
                    </Group>
                  ))}
                </Stack>
              ) : (
                <Text c="dimmed" size="sm">
                  No data available
                </Text>
              )}
            </Card.Section>
          </Card>
        )}
      </SimpleGrid>

      <Card withBorder>
        <Card.Section p={compact ? "sm" : "md"}>
          <Title order={compact ? 5 : 4} mb={compact ? "xs" : "md"}>
            Activity
          </Title>
          <ActivityHeatmap data={activity} compact={compact} />
        </Card.Section>
      </Card>
    </Stack>
  );
}
