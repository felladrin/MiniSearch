import { usePubSub } from "create-pubsub/react";
import {
  modelLoadingProgressPubSub,
  queryPubSub,
  responsePubSub,
  searchResultsPubSub,
  searchStatePubSub,
  textGenerationStatePubSub,
  settingsPubSub,
} from "../../../modules/pubSub";
import { SearchForm } from "./SearchForm/SearchForm";
import Markdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import syntaxHighlighterStyle from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import { SearchResultsList } from "./SearchResultsList/SearchResultsList";
import { match, Pattern } from "ts-pattern";
import {
  CustomProvider,
  Stack,
  VStack,
  Divider,
  Placeholder,
  Message,
  Progress,
  Button,
  Grid,
  Row,
  Col,
} from "rsuite";
import { ImageResultsList } from "./ImageResultsList/ImageResultsList";
import { useEffect, useMemo } from "react";
import { addLogEntry } from "../../../modules/logEntries";

export function Main() {
  const [query, updateQuery] = usePubSub(queryPubSub);
  const [response] = usePubSub(responsePubSub);
  const [searchResults] = usePubSub(searchResultsPubSub);
  const [textGenerationState, setTextGenerationState] = usePubSub(
    textGenerationStatePubSub,
  );
  const [searchState] = usePubSub(searchStatePubSub);
  const [modelLoadingProgress] = usePubSub(modelLoadingProgressPubSub);
  const [settings] = usePubSub(settingsPubSub);

  useEffect(() => {
    addLogEntry(`Search state changed to '${searchState}'`);
  }, [searchState]);

  useEffect(() => {
    addLogEntry(`Text generation state changed to '${textGenerationState}'`);
  }, [textGenerationState]);

  const MemoizedAiResponseSection = useMemo(
    () =>
      match([settings.enableAiResponse, textGenerationState])
        .with([true, Pattern.not("idle")], () => (
          <Stack.Item style={{ width: "100%" }}>
            {match(textGenerationState)
              .with(
                Pattern.union("generating", "interrupted", "completed"),
                () => (
                  <>
                    <Divider>
                      {match(textGenerationState)
                        .with("generating", () => "Generating AI Response...")
                        .with("interrupted", () => "AI Response (Interrupted)")
                        .otherwise(() => "AI Response")}
                    </Divider>
                    <VStack spacing={16}>
                      {match(textGenerationState)
                        .with("generating", () => (
                          <Stack.Item alignSelf="center">
                            <Button
                              size="sm"
                              onClick={() =>
                                setTextGenerationState("interrupted")
                              }
                            >
                              Stop generating
                            </Button>
                          </Stack.Item>
                        ))
                        .otherwise(() => null)}
                      <Stack.Item style={{ width: "100%" }}>
                        <Markdown
                          components={{
                            code(props) {
                              const {
                                children,
                                className,
                                node,
                                ref,
                                ...rest
                              } = props;
                              void node;
                              const languageMatch = /language-(\w+)/.exec(
                                className || "",
                              );
                              return languageMatch ? (
                                <SyntaxHighlighter
                                  {...rest}
                                  ref={ref as never}
                                  children={
                                    children?.toString().replace(/\n$/, "") ??
                                    ""
                                  }
                                  language={languageMatch[1]}
                                  style={syntaxHighlighterStyle}
                                />
                              ) : (
                                <code {...rest} className={className}>
                                  {children}
                                </code>
                              );
                            },
                          }}
                        >
                          {response}
                        </Markdown>
                      </Stack.Item>
                    </VStack>
                  </>
                ),
              )
              .with("loadingModel", () => {
                const isLoadingComplete =
                  modelLoadingProgress === 100 || modelLoadingProgress === 0;

                const percent = isLoadingComplete ? 100 : modelLoadingProgress;

                const strokeColor = isLoadingComplete ? "#52c41a" : "#3385ff";

                const status = isLoadingComplete ? "success" : "active";

                return (
                  <>
                    <Divider>Loading AI...</Divider>
                    <Progress.Line
                      percent={percent}
                      strokeColor={strokeColor}
                      status={status}
                    />
                  </>
                );
              })
              .with(
                Pattern.union("awaitingSearchResults", "preparingToGenerate"),
                () => (
                  <>
                    <Divider>
                      {match(textGenerationState)
                        .with(
                          "awaitingSearchResults",
                          () => "Awaiting search results...",
                        )
                        .with(
                          "preparingToGenerate",
                          () => "Preparing AI response...",
                        )
                        .otherwise(() => "Loading...")}
                    </Divider>
                    <Placeholder.Paragraph rows={4} active />
                  </>
                ),
              )
              .with("failed", () => (
                <>
                  <Divider>AI Response</Divider>
                  <Message
                    type="warning"
                    centered
                    showIcon
                    header="Failed to generate response"
                  >
                    Could not generate response. It's possible that your browser
                    or your system is out of memory.
                  </Message>
                </>
              ))
              .otherwise(() => null)}
          </Stack.Item>
        ))
        .otherwise(() => null),
    [
      settings,
      textGenerationState,
      setTextGenerationState,
      modelLoadingProgress,
      response,
    ],
  );

  const MemoizedSearchResultsSection = useMemo(
    () =>
      match(searchState)
        .with(Pattern.not("idle"), () => (
          <Stack.Item style={{ width: "100%" }}>
            {match(searchState)
              .with("running", () => (
                <>
                  <Divider>Searching the web...</Divider>
                  <Grid fluid>
                    <Row gutter={16}>
                      <Col xs={6}>
                        <Placeholder.Graph active height={100} />
                      </Col>
                      <Col xs={6}>
                        <Placeholder.Graph active height={100} />
                      </Col>
                      <Col xs={6}>
                        <Placeholder.Graph active height={100} />
                      </Col>
                      <Col xs={6}>
                        <Placeholder.Graph active height={100} />
                      </Col>
                    </Row>
                    <Row>
                      <Col xs={24}>
                        <Placeholder.Paragraph
                          rows={8}
                          style={{ marginTop: "16px" }}
                          active
                        />
                      </Col>
                    </Row>
                  </Grid>
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
                    results. Try refining your search by adding more keywords or
                    rephrasing your query.
                  </Message>
                </>
              ))
              .with("completed", () => (
                <>
                  {settings.enableImageSearch &&
                    searchResults.imageResults.length > 0 && (
                      <>
                        <Divider>Images</Divider>
                        <ImageResultsList
                          imageResults={searchResults.imageResults}
                        />
                      </>
                    )}
                  <Divider>Links</Divider>
                  <SearchResultsList
                    searchResults={searchResults.textResults}
                  />
                </>
              ))
              .otherwise(() => null)}
          </Stack.Item>
        ))
        .otherwise(() => null),
    [searchState, searchResults, settings],
  );

  return (
    <CustomProvider theme="dark">
      <Stack
        alignItems="center"
        justifyContent="center"
        style={{
          height: "100%",
          backgroundColor:
            settings.backgroundImageUrl !== "none"
              ? "rgba(0, 0, 0, 0.2)"
              : undefined,
        }}
      >
        <Stack.Item
          grow={1}
          style={{
            padding: "16px 24px",
            maxWidth: "800px",
            minHeight: "100vh",
          }}
        >
          <VStack>
            <Stack.Item style={{ width: "100%" }}>
              <SearchForm query={query} updateQuery={updateQuery} />
            </Stack.Item>
            {MemoizedAiResponseSection}
            {MemoizedSearchResultsSection}
          </VStack>
        </Stack.Item>
      </Stack>
    </CustomProvider>
  );
}
