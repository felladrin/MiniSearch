import { usePubSub } from "create-pubsub/react";
import {
  searchResultsPubSub,
  searchStatePubSub,
  settingsPubSub,
} from "../../../../modules/pubSub";
import { match, Pattern } from "ts-pattern";
import {
  Divider,
  Skeleton,
  Alert,
  Stack,
  Group,
  Space,
  AspectRatio,
  em,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { lazy, Suspense, useMemo } from "react";
import { Settings } from "../../../../modules/settings";
import { SearchResults } from "../../../../modules/search";
import { useMediaQuery } from "@mantine/hooks";

const ImageResultsList = lazy(() => import("../Graphical/ImageResultsList"));
const SearchResultsList = lazy(() => import("../Textual/SearchResultsList"));

export default function SearchResultsSection() {
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
  const hasSmallScreen = useMediaQuery(`(max-width: ${em(530)})`);

  const numberOfSquareSkeletons = hasSmallScreen ? 4 : 6;

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
          {[...Array(numberOfSquareSkeletons)].map((_, index) => (
            <AspectRatio key={index} ratio={1} flex={1}>
              <Skeleton />
            </AspectRatio>
          ))}
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
          <Suspense>
            <ImageResultsList imageResults={searchResults.imageResults} />
            <Space h={8} />
          </Suspense>
        ))
        .otherwise(() => null)}
      <Suspense>
        <SearchResultsList searchResults={searchResults.textResults} />
      </Suspense>
    </>
  );
}
