import { Button, Group, Stack, Textarea } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import { useHistoryRestore } from "../../../hooks/useHistoryRestore";
import { useSearchHistory } from "../../../hooks/useSearchHistory";
import { resetSearchRunId } from "../../../modules/history";
import { handleEnterKeyDown } from "../../../modules/keyboard";
import { addLogEntry } from "../../../modules/logEntries";
import { postMessageToParentWindow } from "../../../modules/parentWindow";
import {
  imageSearchResultsPubSub,
  isRestoringFromHistoryPubSub,
  responsePubSub,
  settingsPubSub,
  textSearchResultsPubSub,
} from "../../../modules/pubSub";
import { getRandomQuerySuggestion } from "../../../modules/querySuggestions";
import { sleepUntilIdle } from "../../../modules/sleep";
import { searchAndRespond } from "../../../modules/textGeneration";
import HistoryButton from "../History/HistoryButton";

interface SearchFormState {
  textAreaValue: string;
  suggestedQuery: string;
}

export default function SearchForm({
  query,
  updateQuery,
  additionalButtons,
}: {
  query: string;
  updateQuery: (query: string) => void;
  additionalButtons?: ReactNode;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const autoInitializedQueriesRef = useRef(new Set<string>());
  const defaultSuggestedQuery = "Anything you need!";
  const [state, setState] = useState<SearchFormState>({
    textAreaValue: query,
    suggestedQuery: defaultSuggestedQuery,
  });

  const [, navigate] = useLocation();
  const [pubSubSettings] = usePubSub(settingsPubSub);
  const [isRestoringFromHistory] = usePubSub(isRestoringFromHistoryPubSub);
  const [textSearchResults] = usePubSub(textSearchResultsPubSub);
  const [imageSearchResults] = usePubSub(imageSearchResultsPubSub);
  const [responseValue] = usePubSub(responsePubSub);
  const { addToHistory } = useSearchHistory();
  const { restoreSearch } = useHistoryRestore((newQuery) => {
    setState((prev) => ({ ...prev, textAreaValue: newQuery }));
    updateQuery(newQuery);
  }, textAreaRef);
  const fetchQuerySuggestion = useCallback(async () => {
    try {
      return await getRandomQuerySuggestion();
    } catch {
      return defaultSuggestedQuery;
    }
  }, []);

  useEffect(() => {
    const initializeComponent = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const urlQuery = urlParams.get("q");
      const normalizedUrlQuery = urlQuery?.trim();

      const hasRestoredResults =
        textSearchResults.length > 0 || imageSearchResults.length > 0;
      const hasRestoredResponse = responseValue.trim().length > 0;

      if (
        normalizedUrlQuery &&
        !autoInitializedQueriesRef.current.has(normalizedUrlQuery) &&
        !isRestoringFromHistory &&
        !hasRestoredResults &&
        !hasRestoredResponse
      ) {
        autoInitializedQueriesRef.current.add(normalizedUrlQuery);
        await sleepUntilIdle();

        try {
          resetSearchRunId();
          await addToHistory(normalizedUrlQuery, {
            type: "text" as const,
            items: [],
          });
        } catch (error) {
          addLogEntry(`Failed to add search to history: ${error}`);
        }

        searchAndRespond();
      }
    };

    void initializeComponent();
  }, [
    isRestoringFromHistory,
    textSearchResults.length,
    imageSearchResults.length,
    responseValue,
    addToHistory,
  ]);

  useEffect(() => {
    if (state.textAreaValue.length === 0) {
      fetchQuerySuggestion()
        .then((suggestion) => {
          setState((prev) => ({ ...prev, suggestedQuery: suggestion }));
        })
        .catch(() => {
          setState((prev) => ({
            ...prev,
            suggestedQuery: defaultSuggestedQuery,
          }));
        });
    }
  }, [state.textAreaValue.length, fetchQuerySuggestion]);

  const handleInputChange = async (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;

    setState((prev) => ({ ...prev, textAreaValue: text }));

    if (text.length === 0) {
      try {
        const suggestion = await getRandomQuerySuggestion();
        setState((prev) => ({ ...prev, suggestedQuery: suggestion }));
      } catch {
        addLogEntry("Failed to get query suggestion");
        setState((prev) => ({
          ...prev,
          suggestedQuery: defaultSuggestedQuery,
        }));
      }
    }
  };

  const handleClearButtonClick = async () => {
    textAreaRef.current?.focus();
    setState((prev) => ({
      ...prev,
      textAreaValue: "",
    }));
    addLogEntry("User cleaned the search query field");
    const suggestion = await fetchQuerySuggestion();
    setState((prev) => ({
      ...prev,
      suggestedQuery: suggestion,
    }));
  };

  const startSearching = useCallback(async () => {
    const queryToEncode =
      state.textAreaValue.trim().length >= 1
        ? state.textAreaValue
        : state.suggestedQuery;
    const normalizedQuery = queryToEncode.trim();

    if (normalizedQuery.length > 0) {
      autoInitializedQueriesRef.current.add(normalizedQuery);
    }

    setState((prev) => ({ ...prev, textAreaValue: queryToEncode }));
    updateQuery(queryToEncode);

    const queryString = `q=${encodeURIComponent(queryToEncode)}`;

    postMessageToParentWindow({ queryString, hash: "" });
    navigate(`/?${queryString}`, { replace: true });

    try {
      resetSearchRunId();
      await addToHistory(queryToEncode, {
        type: "text" as const,
        items: [],
      });
    } catch (error) {
      addLogEntry(`Failed to add search to history: ${error}`);
    }

    searchAndRespond();

    addLogEntry(
      `User submitted a search with ${queryToEncode.length} characters length`,
    );
  }, [
    state.textAreaValue,
    state.suggestedQuery,
    updateQuery,
    navigate,
    addToHistory,
  ]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startSearching();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      handleEnterKeyDown(event, pubSubSettings, startSearching);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ width: "100%", position: "relative" }}
    >
      <Stack gap="xs">
        <Textarea
          value={state.textAreaValue}
          placeholder={
            state.textAreaValue.length === 0 ? state.suggestedQuery : ""
          }
          ref={textAreaRef}
          onKeyDown={handleKeyDown}
          onChange={handleInputChange}
          autosize
          minRows={1}
          maxRows={8}
          autoFocus
        />
        <Group gap="xs">
          <HistoryButton onSearchSelect={restoreSearch} />
          {state.textAreaValue.length >= 1 && (
            <Button
              size="xs"
              onClick={handleClearButtonClick}
              variant="default"
            >
              Clear
            </Button>
          )}
          <Button type="submit" size="xs" variant="default" flex={1}>
            Search
          </Button>
          {additionalButtons}
        </Group>
      </Stack>
    </form>
  );
}
