import { Anchor, Group, Stack, Text } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import { useEffect, useState } from "react";
import SearchForm from "@/components/Search/Form/SearchForm";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { settingsPubSub } from "@/modules/pubSub";
import { getQuerySuggestionSamples } from "@/modules/querySuggestions";
import MenuButton from "./Menu/MenuButton";

const HOME_SUGGESTION_COUNT = 3;
const HOME_RECENT_COUNT = 5;

function homeSearchHref(query: string) {
  return `/?q=${encodeURIComponent(query)}`;
}

/**
 * Runs a callback when the browser is idle, so the home page paints before the
 * suggestions fetch starts. Falls back to a short timeout when requestIdleCallback
 * is unavailable.
 */
function whenIdle(callback: () => void) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback);
  } else {
    setTimeout(callback, 50);
  }
}

export default function HomePage({
  query,
  updateQuery,
}: {
  query: string;
  updateQuery: (query: string) => void;
}) {
  const [settings] = usePubSub(settingsPubSub);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const { recentSearches } = useSearchHistory({
    limit: HOME_RECENT_COUNT,
  });

  useEffect(() => {
    let cancelled = false;
    whenIdle(() => {
      getQuerySuggestionSamples(HOME_SUGGESTION_COUNT)
        .then((samples) => {
          if (!cancelled) setSuggestions(samples);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const recent = settings.enableHistory
    ? recentSearches.slice(0, HOME_RECENT_COUNT)
    : [];

  return (
    <Stack align="center" gap="xl" w="100%" maw={680} mx="auto">
      <Stack align="center" gap={6}>
        <img
          src="/favicon.svg"
          alt=""
          width={40}
          height={40}
          decoding="async"
        />
        <Text fw={700} size="lg">
          MiniSearch
        </Text>
        <Text size="sm" c="dimmed">
          Private AI search in your browser
        </Text>
      </Stack>

      <SearchForm
        query={query}
        updateQuery={updateQuery}
        additionalButtons={<MenuButton />}
      />

      {suggestions.length > 0 && (
        <Stack align="center" gap={8}>
          <Text size="xs" c="dimmed">
            Try
          </Text>
          <Group gap="md" justify="center" wrap="wrap">
            {suggestions.map((suggestion) => (
              <Anchor
                key={suggestion}
                href={homeSearchHref(suggestion)}
                size="sm"
                c="dimmed"
                fw={500}
                underline="hover"
              >
                {suggestion}
              </Anchor>
            ))}
          </Group>
        </Stack>
      )}

      {recent.length > 0 && (
        <Stack align="center" gap={8}>
          <Text size="xs" c="dimmed">
            Recent
          </Text>
          <Group gap="md" justify="center" wrap="wrap">
            {recent.map((entry) => (
              <Anchor
                key={entry.id ?? entry.query}
                href={homeSearchHref(entry.query)}
                size="sm"
                c="dimmed"
                fw={500}
                underline="hover"
              >
                {entry.query}
              </Anchor>
            ))}
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
