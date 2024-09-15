import { usePubSub } from "create-pubsub/react";
import {
  searchResultsPubSub,
  searchStatePubSub,
  settingsPubSub,
} from "../../../modules/pubSub";
import { match, Pattern } from "ts-pattern";
import { Divider, Skeleton, Alert, Stack, Group } from "@mantine/core";
import { ImageResultsList } from "./ImageResultsList/ImageResultsList";
import { SearchResultsList } from "./SearchResultsList/SearchResultsList";
import { IconInfoCircle } from "@tabler/icons-react";
import { useMemo } from "react";
import { Settings } from "../../../modules/settings";
import { SearchResults } from "../../../modules/search";

export function SearchResultsSection() {
  const [searchResults] = usePubSub(searchResultsPubSub);
  const [searchState] = usePubSub(searchStatePubSub);
  const [settings] = usePubSub(settingsPubSub);

  return useMemo(
    () =>
      match(searchState)
        .with("running", () => <RunningSearchContent />)
        .with("failed", () => <FailedSearchContent />)
        .with("completed", () => (
          <CompletedSearchContent
            searchResults={searchResults}
            settings={settings}
          />
        ))
        .otherwise(() => null),
    [searchState, searchResults, settings],
  );
}

function RunningSearchContent() {
  return (
    <>
      <Divider
        mb="sm"
        variant="dashed"
        labelPosition="center"
        label="Searching the web..."
      />
      <Stack>
        <Group>
          <Skeleton flex={1} height={180} />
          <Skeleton flex={1} height={180} />
          <Skeleton flex={1} height={180} />
          <Skeleton flex={1} height={180} />
        </Group>
        <Stack>
          <Skeleton height={8} radius="xl" />
          <Skeleton height={8} width="87%" radius="xl" />
          <Skeleton height={8} radius="xl" />
          <Skeleton height={8} width="70%" radius="xl" />
          <Skeleton height={8} radius="xl" />
          <Skeleton height={8} width="52%" radius="xl" />
          <Skeleton height={8} radius="xl" />
          <Skeleton height={8} width="63%" radius="xl" />
        </Stack>
      </Stack>
    </>
  );
}

function FailedSearchContent() {
  return (
    <>
      <Divider
        mb="sm"
        variant="dashed"
        labelPosition="center"
        label="Search Results"
      />
      <Alert
        variant="light"
        color="yellow"
        title="No results found"
        icon={<IconInfoCircle />}
      >
        It looks like your current search did not return any results. Try
        refining your search by adding more keywords or rephrasing your query.
      </Alert>
    </>
  );
}

function CompletedSearchContent({
  searchResults,
  settings,
}: {
  searchResults: SearchResults;
  settings: Settings;
}) {
  return (
    <>
      <Divider variant="dashed" labelPosition="center" label="Search Results" />
      {match([settings.enableImageSearch, searchResults.imageResults.length])
        .with([true, Pattern.number.positive()], () => (
          <ImageResultsList imageResults={searchResults.imageResults} />
        ))
        .otherwise(() => null)}
      <SearchResultsList searchResults={searchResults.textResults} />
    </>
  );
}
