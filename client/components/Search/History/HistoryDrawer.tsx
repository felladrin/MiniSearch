import {
  ActionIcon,
  Card,
  Center,
  Divider,
  Drawer,
  type DrawerProps,
  Group,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconChartBar,
  IconClock,
  IconHistory,
  IconPin,
  IconPinFilled,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { useEffect, useState } from "react";
import { useSearchHistory } from "../../../hooks/useSearchHistory";
import type { SearchEntry } from "../../../modules/history";
import { settingsPubSub } from "../../../modules/pubSub";
import { formatRelativeTime } from "../../../modules/stringFormatters";

import SearchStats from "../../Analytics/SearchStats";

interface HistoryDrawerProps extends Omit<DrawerProps, "children"> {
  onSearchSelect?: (entry: SearchEntry) => void;
}

export default function HistoryDrawer({
  onSearchSelect,
  ...drawerProps
}: HistoryDrawerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<string | null>("history");
  const [settings] = usePubSub(settingsPubSub);
  const {
    filteredSearches,
    groupedSearches,
    togglePin,
    deleteEntry,
    searchHistory,
  } = useSearchHistory({ limit: 100, enableGrouping: true });

  useEffect(() => {
    searchHistory(searchQuery);
  }, [searchQuery, searchHistory]);

  const handleSearchSelect = (search: SearchEntry) => {
    if (onSearchSelect) {
      onSearchSelect(search);
    }
  };

  const handlePin = (searchId: number) => {
    togglePin(searchId);
  };

  const handleDelete = (searchId: number) => {
    if (window.confirm("Delete this search from history?")) {
      deleteEntry(searchId);
    }
  };

  const renderSearchItem = (search: SearchEntry, index: number) => (
    <Card
      key={search.id || index}
      p="sm"
      radius="md"
      style={{ cursor: "pointer" }}
      className="hover:bg-gray-50 dark:hover:bg-gray-800"
      onClick={() => handleSearchSelect(search)}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text
              size="sm"
              fw={search.isPinned ? 600 : 400}
              style={{
                wordBreak: "break-word",
                lineHeight: 1.3,
              }}
            >
              {search.query}
            </Text>
          </Group>

          <Group gap="xs" align="center">
            <Text
              size="xs"
              c="dimmed"
              style={{ display: "flex", alignItems: "center", gap: 4 }}
            >
              <IconClock size={12} />
              {formatRelativeTime(search.timestamp)}
            </Text>
          </Group>
        </Stack>

        <Group gap="xs" style={{ flexShrink: 0 }}>
          <ActionIcon
            variant="subtle"
            color={search.isPinned ? "blue" : "gray"}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              if (search.id) handlePin(search.id);
            }}
            aria-label={search.isPinned ? "Unpin search" : "Pin search"}
          >
            {search.isPinned ? (
              <IconPinFilled size={14} />
            ) : (
              <IconPin size={14} />
            )}
          </ActionIcon>

          <ActionIcon
            variant="subtle"
            color="default"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              if (search.id) handleDelete(search.id);
            }}
            aria-label="Delete search"
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Group>
    </Card>
  );

  const renderGroupedSearches = () => {
    const pinnedSearches = filteredSearches.filter((search) => search.isPinned);
    const unpinnedSearches = filteredSearches.filter(
      (search) => !search.isPinned,
    );

    const content = [];

    if (pinnedSearches.length > 0) {
      content.push(
        <Stack key="pinned" gap="xs">
          <Text size="sm" fw={600} c="blue" tt="uppercase">
            Pinned
          </Text>
          {pinnedSearches.map(renderSearchItem)}
          <Divider my="sm" />
        </Stack>,
      );
    }

    if (
      Object.keys(groupedSearches).length === 0 ||
      unpinnedSearches.length === 0
    ) {
      content.push(...unpinnedSearches.map(renderSearchItem));
    } else {
      const unpinnedGrouped = unpinnedSearches.reduce(
        (acc, search) => {
          for (const [period, searches] of Object.entries(groupedSearches)) {
            if (searches.some((s) => s.id === search.id)) {
              if (!acc[period]) acc[period] = [];
              acc[period].push(search);
              break;
            }
          }
          return acc;
        },
        {} as Record<string, typeof unpinnedSearches>,
      );

      Object.entries(unpinnedGrouped).forEach(([period, searches]) => {
        if (searches.length > 0) {
          content.push(
            <Stack key={period} gap="xs">
              <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                {period}
              </Text>
              {searches.map(renderSearchItem)}
            </Stack>,
          );
        }
      });
    }

    return content;
  };

  if (!settings.enableHistory) {
    return (
      <Drawer {...drawerProps} position="left" size="md" title="Search History">
        <Center h={200}>
          <Stack align="center" gap="xs">
            <Text c="dimmed">Search history is disabled</Text>
            <Text size="sm" c="dimmed">
              Enable it in settings to see your recent searches
            </Text>
          </Stack>
        </Center>
      </Drawer>
    );
  }

  return (
    <Drawer
      {...drawerProps}
      position="left"
      size="md"
      title={
        <Group gap="xs">
          <Text fw={600}>Search History & Analytics</Text>
        </Group>
      }
    >
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List grow>
          <Tabs.Tab value="history" leftSection={<IconHistory size={16} />}>
            History
          </Tabs.Tab>
          <Tabs.Tab value="analytics" leftSection={<IconChartBar size={16} />}>
            Analytics
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="history" pt="md">
          <Stack gap="md">
            <TextInput
              placeholder="Filter history..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              leftSection={<IconSearch size={16} />}
              rightSection={
                searchQuery && (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    onClick={() => setSearchQuery("")}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                )
              }
              size="sm"
              style={{ flex: 1 }}
            />

            <ScrollArea.Autosize mah="calc(100vh - 280px)">
              {filteredSearches.length === 0 ? (
                <Center py="xl">
                  <Stack align="center" gap="xs">
                    <IconSearch size={32} color="gray" />
                    <Text c="dimmed">
                      {searchQuery
                        ? "No matching searches found"
                        : "No search history yet"}
                    </Text>
                    {!searchQuery && (
                      <Text size="sm" c="dimmed" ta="center">
                        Your recent searches will appear here
                      </Text>
                    )}
                  </Stack>
                </Center>
              ) : (
                <Stack gap="xs">{renderGroupedSearches()}</Stack>
              )}
            </ScrollArea.Autosize>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="analytics" pt="md">
          <ScrollArea.Autosize mah="calc(100vh - 280px)">
            <SearchStats period="all" compact />
          </ScrollArea.Autosize>
        </Tabs.Panel>
      </Tabs>
    </Drawer>
  );
}
