import { Alert, Loader, Stack, Text } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import { Suspense, lazy } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { settingsPubSub } from "../../../modules/pubSub";

const TextSearchResults = lazy(() => import("./Textual/TextSearchResults"));
const ImageSearchResults = lazy(() => import("./Graphical/ImageSearchResults"));

const ErrorFallback = ({ error }: { error: Error }) => (
  <Alert color="red" title="Error loading search results">
    <Text size="sm">{error.message}</Text>
    <Text size="xs" c="dimmed">
      Please try again later or contact support if the issue persists.
    </Text>
  </Alert>
);

const LoadingFallback = () => (
  <Stack align="center" p="md">
    <Loader size="sm" />
    <Text size="sm" c="dimmed">
      Loading component, please wait...
    </Text>
  </Stack>
);

export default function SearchResultsSection() {
  const [settings] = usePubSub(settingsPubSub);

  const renderSearchResults = (
    Component: React.LazyExoticComponent<React.ComponentType>,
    enabled: boolean,
  ) =>
    enabled && (
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <Suspense fallback={<LoadingFallback />}>
          <Component />
        </Suspense>
      </ErrorBoundary>
    );

  return (
    <Stack gap="xl">
      {renderSearchResults(ImageSearchResults, settings.enableImageSearch)}
      {renderSearchResults(TextSearchResults, settings.enableTextSearch)}
    </Stack>
  );
}
