import { Alert } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { Suspense, lazy } from "react";
import { match } from "ts-pattern";
import {
  textSearchResultsPubSub,
  textSearchStatePubSub,
} from "../../../../modules/pubSub";

const SearchResultsList = lazy(() => import("./SearchResultsList"));
const TextResultsLoadingState = lazy(() => import("./TextResultsLoadingState"));

export default function TextSearchResults() {
  const [searchState] = usePubSub(textSearchStatePubSub);
  const [results] = usePubSub(textSearchResultsPubSub);

  return match(searchState)
    .with("running", () => (
      <Suspense>
        <TextResultsLoadingState />
      </Suspense>
    ))
    .with("completed", () =>
      results.length > 0 ? (
        <Suspense>
          <SearchResultsList searchResults={results} />
        </Suspense>
      ) : (
        <Alert
          variant="light"
          color="yellow"
          title="No results found"
          icon={<IconInfoCircle />}
        >
          No text results found for your search query.
        </Alert>
      ),
    )
    .with("failed", () => (
      <Alert
        variant="light"
        color="red"
        title="Search failed"
        icon={<IconInfoCircle />}
      >
        Failed to fetch text results. Please try again.
      </Alert>
    ))
    .otherwise(() => null);
}
