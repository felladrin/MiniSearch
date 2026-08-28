import { Alert, Button, Group } from "@mantine/core";
import { IconInfoCircle, IconRefresh } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import {
  imageSearchResultsPubSub,
  imageSearchStatePubSub,
  settingsPubSub,
  textSearchResultsPubSub,
  textSearchStalePubSub,
  textSearchStatePubSub,
} from "@/modules/pubSub";
import { searchAndRespond } from "@/modules/textGeneration";

import SearchResultsList from "./SearchResultsList";
import TextResultsLoadingState from "./TextResultsLoadingState";

export default function TextSearchResults() {
  const [searchState] = usePubSub(textSearchStatePubSub);
  const [results] = usePubSub(textSearchResultsPubSub);
  const [stale] = usePubSub(textSearchStalePubSub);
  const [imageState] = usePubSub(imageSearchStatePubSub);
  const [imageResults] = usePubSub(imageSearchResultsPubSub);
  const [settings] = usePubSub(settingsPubSub);

  if (searchState === "running") {
    return <TextResultsLoadingState />;
  }

  if (searchState === "completed") {
    if (results.length > 0) {
      return (
        <>
          {stale && (
            <Alert
              variant="light"
              color="yellow"
              title="Showing cached results"
              icon={<IconInfoCircle />}
              mb="sm"
            >
              The live search is temporarily unavailable, so some of these
              results are from an earlier search and may be out of date.
            </Alert>
          )}
          <SearchResultsList searchResults={results} />
        </>
      );
    }

    return (
      <Alert
        variant="light"
        color="yellow"
        title="No results found"
        icon={<IconInfoCircle />}
      >
        No text results found for your search query.
      </Alert>
    );
  }

  if (searchState === "failed") {
    const imagesAvailable =
      imageState === "completed" && imageResults.length > 0;
    const usedImagesForAnswer = imagesAvailable && settings.enableAiResponse;

    return (
      <Alert
        variant="light"
        color="red"
        title="Text search unavailable"
        icon={<IconInfoCircle />}
      >
        <span>
          The text search is temporarily unavailable, so no live text results
          could be fetched. This usually clears on its own.
        </span>
        {usedImagesForAnswer && (
          <span>
            {" "}
            The answer above was grounded on the image results instead.
          </span>
        )}
        <Group mt="sm">
          <Button
            onClick={searchAndRespond}
            variant="light"
            size="sm"
            leftSection={<IconRefresh size={16} />}
          >
            Retry Search
          </Button>
        </Group>
      </Alert>
    );
  }

  return null;
}
