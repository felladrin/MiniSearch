import { Alert, Box, Divider, Stack, Text } from "@mantine/core";
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
    displayDivider: boolean,
    enabled: boolean,
  ) =>
    enabled && (
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <Box>
          {displayDivider && <Divider mb="sm" variant="dashed" />}
          <Component />
        </Box>
      </ErrorBoundary>
    );

  return (
    <Stack gap="sm">
      {renderSearchResults(
        ImageSearchResults,
        false,
        settings.enableImageSearch,
      )}
      {renderSearchResults(TextSearchResults, true, settings.enableTextSearch)}
    </Stack>
  );
}
