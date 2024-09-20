import { usePubSub } from "create-pubsub/react";
import {
  queryPubSub,
  searchStatePubSub,
  textGenerationStatePubSub,
} from "../../modules/pubSub";
import { SearchForm } from "../Search/Form/SearchForm";
import { Container, Stack } from "@mantine/core";
import { useEffect } from "react";
import { addLogEntry } from "../../modules/logEntries";
import { AiResponseSection } from "../AiResponse/AiResponseSection";
import { SearchResultsSection } from "../Search/Results/Textual/SearchResultsSection";
import { MenuButton } from "../Menu/MenuButton";

export function Layout() {
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
    <Container p="lg">
      <Stack>
        <SearchForm
          query={query}
          updateQuery={updateQuery}
          additionalButtons={<MenuButton />}
        />
        <AiResponseSection />
        <SearchResultsSection />
      </Stack>
    </Container>
  );
}
