import { Alert } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { Suspense, lazy } from "react";
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

  if (searchState === "running") {
    return (
      <Suspense>
        <ImageResultsLoadingState />
      </Suspense>
    );
  }

  if (searchState === "completed") {
    if (results.length > 0) {
      return (
        <Suspense>
          <ImageResultsList imageResults={results} />
        </Suspense>
      );
    }

    return (
      <Alert
        variant="light"
        color="yellow"
        title="No image results found"
        icon={<IconInfoCircle />}
      >
        Could not find any images matching your search query.
      </Alert>
    );
  }

  if (searchState === "failed") {
    return (
      <Alert
        variant="light"
        color="yellow"
        title="Failed to search for images"
        icon={<IconInfoCircle />}
      >
        Could not search for images.
      </Alert>
    );
  }

  return null;
}
