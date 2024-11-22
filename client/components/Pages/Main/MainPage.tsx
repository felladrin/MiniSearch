import { Center, Container, Loader, Stack } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import { Suspense } from "react";
import { lazy } from "react";
import { Pattern, match } from "ts-pattern";
import {
  imageSearchStatePubSub,
  queryPubSub,
  textGenerationStatePubSub,
  textSearchStatePubSub,
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
  const [textSearchState] = usePubSub(textSearchStatePubSub);
  const [imageSearchState] = usePubSub(imageSearchStatePubSub);
  const [textGenerationState] = usePubSub(textGenerationStatePubSub);

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
        {match([textSearchState, imageSearchState])
          .with(
            [Pattern.not("idle"), Pattern.any],
            [Pattern.any, Pattern.not("idle")],
            () => (
              <Suspense>
                <SearchResultsSection />
              </Suspense>
            ),
          )
          .otherwise(() => null)}
      </Stack>
    </Container>
  );
}
