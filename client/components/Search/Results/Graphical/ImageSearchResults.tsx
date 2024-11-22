import { Alert } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { Suspense, lazy } from "react";
import { match } from "ts-pattern";
import {
  imageSearchResultsPubSub,
  imageSearchStatePubSub,
} from "../../../../modules/pubSub";

const ImageResultsList = lazy(() => import("./ImageResultsList"));
const ImageResultsLoadingState = lazy(
  () => import("./ImageResultsLoadingState"),
);

export default function ImageSearchResults() {
  const [searchState] = usePubSub(imageSearchStatePubSub);
  const [results] = usePubSub(imageSearchResultsPubSub);

  return match(searchState)
    .with("running", () => (
      <Suspense>
        <ImageResultsLoadingState />
      </Suspense>
    ))
    .with("completed", () =>
      results.length > 0 ? (
        <Suspense>
          <ImageResultsList imageResults={results} />
        </Suspense>
      ) : (
        <Alert
          variant="light"
          color="yellow"
          title="No images found"
          icon={<IconInfoCircle />}
        >
          No image results found for your search query.
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
        Failed to fetch image results. Please try again.
      </Alert>
    ))
    .otherwise(() => null);
}
