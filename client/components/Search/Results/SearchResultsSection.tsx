import { Stack } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import { Suspense, lazy } from "react";
import { settingsPubSub } from "../../../modules/pubSub";

const TextSearchResults = lazy(() => import("./Textual/TextSearchResults"));
const ImageSearchResults = lazy(() => import("./Graphical/ImageSearchResults"));

export default function SearchResultsSection() {
  const [settings] = usePubSub(settingsPubSub);

  return (
    <Stack gap="xl">
      {settings.enableImageSearch && (
        <Suspense>
          <ImageSearchResults />
        </Suspense>
      )}
      {settings.enableTextSearch && (
        <Suspense>
          <TextSearchResults />
        </Suspense>
      )}
    </Stack>
  );
}
