import { Alert } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import {
  imageSearchResultsPubSub,
  imageSearchStatePubSub,
} from "../../../../modules/pubSub";

import ImageResultsList from "./ImageResultsList";
import ImageResultsLoadingState from "./ImageResultsLoadingState";

export default function ImageSearchResults() {
  const [searchState] = usePubSub(imageSearchStatePubSub);
  const [results] = usePubSub(imageSearchResultsPubSub);

  if (searchState === "running") {
    return <ImageResultsLoadingState />;
  }

  if (searchState === "completed") {
    if (results.length > 0) {
      return <ImageResultsList imageResults={results} />;
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
