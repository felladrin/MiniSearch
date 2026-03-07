import { Alert, Button, Group } from "@mantine/core";
import { IconInfoCircle, IconRefresh } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import {
  textSearchResultsPubSub,
  textSearchStatePubSub,
} from "@/modules/pubSub";
import { searchAndRespond } from "@/modules/textGeneration";

import SearchResultsList from "./SearchResultsList";
import TextResultsLoadingState from "./TextResultsLoadingState";

export default function TextSearchResults() {
  const [searchState] = usePubSub(textSearchStatePubSub);
  const [results] = usePubSub(textSearchResultsPubSub);

  if (searchState === "running") {
    return <TextResultsLoadingState />;
  }

  if (searchState === "completed") {
    if (results.length > 0) {
      return <SearchResultsList searchResults={results} />;
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
    return (
      <Alert
        variant="light"
        color="red"
        title="Search failed"
        icon={<IconInfoCircle />}
      >
        Failed to fetch text results. Please try again.
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
