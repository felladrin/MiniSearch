import { usePubSub } from "create-pubsub/react";
import {
  queryPubSub,
  searchStatePubSub,
  textGenerationStatePubSub,
} from "../../../modules/pubSub";
import { Container, Stack } from "@mantine/core";
import { Suspense, useEffect } from "react";
import { addLogEntry } from "../../../modules/logEntries";
import { lazy } from "react";
import { match, Pattern } from "ts-pattern";

const AiResponseSection = lazy(
  () => import("../../AiResponse/AiResponseSection"),
);
const SearchResultsSection = lazy(
  () => import("../../Search/Results/Textual/SearchResultsSection"),
);
const MenuButton = lazy(() => import("./Menu/MenuButton"));
const SearchForm = lazy(() => import("../../Search/Form/SearchForm"));

export default function MainPage() {
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
        {match(textGenerationState)
          .with(Pattern.not("idle"), () => (
            <Suspense>
              <AiResponseSection />
            </Suspense>
          ))
          .otherwise(() => null)}
        {match(searchState)
          .with(Pattern.not("idle"), () => (
            <Suspense>
              <SearchResultsSection />
            </Suspense>
          ))
          .otherwise(() => null)}
      </Stack>
    </Container>
  );
}
