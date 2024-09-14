import { usePubSub } from "create-pubsub/react";
import {
  queryPubSub,
  searchStatePubSub,
  textGenerationStatePubSub,
} from "../../../modules/pubSub";
import { SearchForm } from "./SearchForm/SearchForm";
import { Container, Stack } from "@mantine/core";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { useEffect } from "react";
import { addLogEntry } from "../../../modules/logEntries";
import { AiResponseSection } from "./AiResponseSection";
import { SearchResultsSection } from "./SearchResultsSection";

export function Main() {
  const [query, updateQuery] = usePubSub(queryPubSub);
  const [searchState] = usePubSub(searchStatePubSub);
  const [textGenerationState] = usePubSub(textGenerationStatePubSub);

  useEffect(() => {
    addLogEntry(`Search state changed to '${searchState}'`);
  }, [searchState]);

  useEffect(() => {
    addLogEntry(`Text generation state changed to '${textGenerationState}'`);
  }, [textGenerationState]);

  return (
    <MantineProvider defaultColorScheme="dark">
      <Notifications />
      <Container p="lg">
        <Stack>
          <SearchForm query={query} updateQuery={updateQuery} />
          <AiResponseSection />
          <SearchResultsSection />
        </Stack>
      </Container>
    </MantineProvider>
  );
}
