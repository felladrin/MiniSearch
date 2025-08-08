import { Alert, Stack, Text } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import { ErrorBoundary } from "react-error-boundary";
import { settingsPubSub } from "../../../modules/pubSub";
import ImageSearchResults from "./Graphical/ImageSearchResults";
import TextSearchResults from "./Textual/TextSearchResults";

const ErrorFallback = ({ error }: { error: Error }) => (
  <Alert color="red" title="Error loading search results">
    <Text size="sm">{error.message}</Text>
    <Text size="xs" c="dimmed">
      Please try refreshing the page.
    </Text>
  </Alert>
);

export default function SearchResultsSection() {
  const [settings] = usePubSub(settingsPubSub);

  const renderSearchResults = (
    Component: React.ComponentType,
    enabled: boolean,
  ) =>
    enabled && (
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <Component />
      </ErrorBoundary>
    );

  return (
    <Stack gap="xl">
      {renderSearchResults(ImageSearchResults, settings.enableImageSearch)}
      {renderSearchResults(TextSearchResults, settings.enableTextSearch)}
    </Stack>
  );
}
