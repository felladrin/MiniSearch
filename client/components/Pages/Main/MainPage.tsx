import { Container, Stack } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import { lazy, Suspense } from "react";
import SearchForm from "@/components/Search/Form/SearchForm";
import {
  imageSearchStatePubSub,
  queryPubSub,
  settingsPubSub,
  textGenerationStatePubSub,
  textSearchStatePubSub,
} from "@/modules/pubSub";
import { searchAndRespond } from "@/modules/textGeneration";
import MenuButton from "./Menu/MenuButton";

const AiResponseSection = lazy(
  () => import("@/components/AiResponse/AiResponseSection"),
);
const SearchResultsSection = lazy(
  () => import("@/components/Search/Results/SearchResultsSection"),
);
const EnableAiResponsePrompt = lazy(
  () => import("@/components/AiResponse/EnableAiResponsePrompt"),
);

export default function MainPage() {
  const [query, updateQuery] = usePubSub(queryPubSub);
  const [textSearchState] = usePubSub(textSearchStatePubSub);
  const [imageSearchState] = usePubSub(imageSearchStatePubSub);
  const [textGenerationState] = usePubSub(textGenerationStatePubSub);
  const [settings, setSettings] = usePubSub(settingsPubSub);

  const isQueryEmpty = query.length === 0;

  return (
    <Container>
      <Stack py="md" mih="100vh" justify={isQueryEmpty ? "center" : undefined}>
        <SearchForm
          query={query}
          updateQuery={updateQuery}
          additionalButtons={<MenuButton />}
        />
        {!isQueryEmpty && (
          <>
            {settings.showEnableAiResponsePrompt && (
              <Suspense>
                <EnableAiResponsePrompt
                  onAccept={() => {
                    setSettings({
                      ...settings,
                      showEnableAiResponsePrompt: false,
                      enableAiResponse: true,
                    });
                    searchAndRespond();
                  }}
                  onDecline={() => {
                    setSettings({
                      ...settings,
                      showEnableAiResponsePrompt: false,
                      enableAiResponse: false,
                    });
                  }}
                />
              </Suspense>
            )}
            {!settings.showEnableAiResponsePrompt &&
              textGenerationState !== "idle" && (
                <Suspense>
                  <AiResponseSection />
                </Suspense>
              )}
            {(textSearchState !== "idle" || imageSearchState !== "idle") && (
              <Suspense>
                <SearchResultsSection />
              </Suspense>
            )}
          </>
        )}
      </Stack>
    </Container>
  );
}
