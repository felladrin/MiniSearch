import { Center, Container, Loader, Stack } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import { Suspense } from "react";
import { lazy } from "react";
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
        justify={query.length === 0 ? "center" : undefined}
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
        {textGenerationState !== "idle" && (
          <Suspense>
            <AiResponseSection />
          </Suspense>
        )}
        {(textSearchState !== "idle" || imageSearchState !== "idle") && (
          <Suspense>
            <SearchResultsSection />
          </Suspense>
        )}
      </Stack>
    </Container>
  );
}
