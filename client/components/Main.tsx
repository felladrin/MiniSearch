import { usePubSub } from "create-pubsub/react";
import {
  getDisableAiResponseSetting,
  modelLoadingProgressPubSub,
  queryPubSub,
  responsePubSub,
  searchResultsPubSub,
  searchStatePubSub,
  textGenerationStatePubSub,
  urlsDescriptionsPubSub,
} from "../modules/pubSub";
import { SearchForm } from "./SearchForm";
import Markdown from "markdown-to-jsx";
import { SearchResultsList } from "./SearchResultsList";
import { match, Pattern } from "ts-pattern";
import {
  CustomProvider,
  Stack,
  VStack,
  Text,
  Divider,
  Placeholder,
  Message,
} from "rsuite";

export function Main() {
  const [query, updateQuery] = usePubSub(queryPubSub);
  const [response] = usePubSub(responsePubSub);
  const [searchResults] = usePubSub(searchResultsPubSub);
  const [urlsDescriptions] = usePubSub(urlsDescriptionsPubSub);
  const [textGenerationState] = usePubSub(textGenerationStatePubSub);
  const [searchState] = usePubSub(searchStatePubSub);
  const [modelLoadingProgress] = usePubSub(modelLoadingProgressPubSub);

  return (
    <CustomProvider theme="dark">
      <Stack
        alignItems="center"
        justifyContent="center"
        style={{
          margin: "20px auto",
          padding: "0 10px",
        }}
      >
        <Stack.Item
          grow={1}
          style={{
            width: "calc(100vw - 20px)",
            maxWidth: "800px",
          }}
        >
          <VStack>
            <Stack.Item style={{ width: "100%" }}>
              <SearchForm query={query} updateQuery={updateQuery} />
            </Stack.Item>
            {match([getDisableAiResponseSetting(), textGenerationState])
              .with([false, Pattern.not("idle")], () => (
                <Stack.Item style={{ width: "100%" }}>
                  {match(textGenerationState)
                    .with(
                      Pattern.union("generating", "interrupted", "completed"),
                      () => (
                        <>
                          <Divider>AI Response</Divider>
                          <Markdown
                            options={{
                              overrides: {
                                span: {
                                  component: Text,
                                  props: {
                                    size: "md",
                                    as: "span",
                                  },
                                },
                                p: {
                                  component: Text,
                                  props: {
                                    size: "md",
                                    as: "p",
                                  },
                                },
                                li: {
                                  component: Text,
                                  props: {
                                    size: "md",
                                    as: "li",
                                  },
                                },
                              },
                            }}
                          >
                            {response}
                          </Markdown>
                        </>
                      ),
                    )
                    .with(
                      Pattern.union(
                        "loadingModel",
                        "awaitingSearchResults",
                        "preparingToGenerate",
                      ),
                      () => (
                        <>
                          <Divider>
                            {match(textGenerationState)
                              .with(
                                "loadingModel",
                                () => `Loading AI: ${modelLoadingProgress}%`,
                              )
                              .with(
                                "awaitingSearchResults",
                                () => "Awaiting search results...",
                              )
                              .with(
                                "preparingToGenerate",
                                () => "Preparing response...",
                              )
                              .otherwise(() => "Loading...")}
                          </Divider>
                          <Placeholder.Paragraph rows={4} active />
                        </>
                      ),
                    )
                    .with("failed", () => (
                      <Message
                        type="warning"
                        centered
                        showIcon
                        header="Failed to generate response"
                      >
                        Could not generate response. The browser may be out of
                        memory. Please close this tab and run this search again
                        in a new one.
                      </Message>
                    ))
                    .otherwise(() => null)}
                </Stack.Item>
              ))
              .otherwise(() => null)}
            {match(searchState)
              .with(Pattern.not("idle"), () => (
                <Stack.Item style={{ width: "100%" }}>
                  {match(searchState)
                    .with("running", () => (
                      <>
                        <Divider>Searching the web...</Divider>
                        <Placeholder.Paragraph rows={8} active />
                      </>
                    ))
                    .with("failed", () => (
                      <>
                        <Divider>Search Results</Divider>
                        <Message
                          type="info"
                          centered
                          showIcon
                          header="No results found"
                        >
                          It looks like your current search did not return any
                          results. Try refining your search by adding more
                          keywords or rephrasing your query.
                        </Message>
                      </>
                    ))
                    .with("completed", () => (
                      <>
                        <Divider>Search Results</Divider>
                        <SearchResultsList
                          searchResults={searchResults}
                          urlsDescriptions={urlsDescriptions}
                        />
                      </>
                    ))
                    .otherwise(() => null)}
                </Stack.Item>
              ))
              .otherwise(() => null)}
          </VStack>
        </Stack.Item>
      </Stack>
    </CustomProvider>
  );
}
