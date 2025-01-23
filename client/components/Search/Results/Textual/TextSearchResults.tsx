import { Alert } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { Suspense, lazy } from "react";
import {
  textSearchResultsPubSub,
  textSearchStatePubSub,
} from "../../../../modules/pubSub";

const SearchResultsList = lazy(() => import("./SearchResultsList"));
const TextResultsLoadingState = lazy(() => import("./TextResultsLoadingState"));

export default function TextSearchResults() {
  const [searchState] = usePubSub(textSearchStatePubSub);
  const [results] = usePubSub(textSearchResultsPubSub);

  if (searchState === "running") {
    return (
      <Suspense>
        <TextResultsLoadingState />
      </Suspense>
    );
  }

  if (searchState === "completed") {
    if (results.length > 0) {
      return (
        <Suspense>
          <SearchResultsList searchResults={results} />
        </Suspense>
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
    return (
      <Alert
        variant="light"
        color="red"
        title="Search failed"
        icon={<IconInfoCircle />}
      >
        Failed to fetch text results. Please try refreshing the page.
      </Alert>
    );
  }

  return null;
}
