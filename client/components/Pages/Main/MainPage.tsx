import { Center, Container, Loader, Stack } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import { Suspense, useEffect } from "react";
import { lazy } from "react";
import { Pattern, match } from "ts-pattern";
import { addLogEntry } from "../../../modules/logEntries";
import {
  queryPubSub,
  searchStatePubSub,
  textGenerationStatePubSub,
} from "../../../modules/pubSub";

const AiResponseSection = lazy(
  () => import("../../AiResponse/AiResponseSection"),
);
const SearchResultsSection = lazy(
  () => import("../../Search/Results/SearchResultsSection"),
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
    <Container>
      <Stack
        py="md"
        mih="100vh"
        justify={match(query)
          .with(Pattern.string.length(0), () => "center")
          .otherwise(() => undefined)}
      >
        <Suspense
          fallback={
            <Center>
              <Loader type="bars" />
            </Center>
          }
        >
          <SearchForm
            query={query}
            updateQuery={updateQuery}
            additionalButtons={<MenuButton />}
          />
        </Suspense>
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
