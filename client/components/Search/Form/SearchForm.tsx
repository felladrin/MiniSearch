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
import { handleEnterKeyDown } from "../../../modules/keyboard";
import { addLogEntry } from "../../../modules/logEntries";
import { postMessageToParentWindow } from "../../../modules/parentWindow";
import { settingsPubSub } from "../../../modules/pubSub";
import { getRandomQuerySuggestion } from "../../../modules/querySuggestions";
import { sleepUntilIdle } from "../../../modules/sleep";
import { searchAndRespond } from "../../../modules/textGeneration";

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
  const defaultSuggestedQuery = "Anything you need!";
  const [state, setState] = useState<SearchFormState>({
    textAreaValue: query,
    suggestedQuery: defaultSuggestedQuery,
  });
  const [, navigate] = useLocation();
  const [settings] = usePubSub(settingsPubSub);

  const handleMount = useCallback(async () => {
    await sleepUntilIdle();
    searchAndRespond();
  }, []);

  const fetchQuerySuggestion = useCallback(async () => {
    try {
      return await getRandomQuerySuggestion();
    } catch (_) {
      addLogEntry("Failed to get query suggestion");
      return defaultSuggestedQuery;
    }
  }, []);

  const handleInitialSuggestion = useCallback(async () => {
    const suggestion = await fetchQuerySuggestion();
    setState((prev) => ({ ...prev, suggestedQuery: suggestion }));
  }, [fetchQuerySuggestion]);

  useEffect(() => {
    handleMount();
    handleInitialSuggestion();
  }, [handleMount, handleInitialSuggestion]);

  const handleInputChange = async (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;

    setState((prev) => ({ ...prev, textAreaValue: text }));

    if (text.length === 0) {
      try {
        const suggestion = await getRandomQuerySuggestion();
        setState((prev) => ({ ...prev, suggestedQuery: suggestion }));
      } catch (_) {
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

  const startSearching = useCallback(() => {
    const queryToEncode =
      state.textAreaValue.trim().length >= 1
        ? state.textAreaValue
        : state.suggestedQuery;

    setState((prev) => ({ ...prev, textAreaValue: queryToEncode }));

    const queryString = `q=${encodeURIComponent(queryToEncode)}`;

    postMessageToParentWindow({ queryString, hash: "" });

    navigate(`/?${queryString}`, { replace: true });

    updateQuery(queryToEncode);

    searchAndRespond();

    addLogEntry(
      `User submitted a search with ${queryToEncode.length} characters length`,
    );
  }, [state.textAreaValue, state.suggestedQuery, updateQuery, navigate]);

  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    startSearching();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    handleEnterKeyDown(event, settings, () => handleSubmit(event));
  };

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <Stack gap="xs">
        <Textarea
          size="sm"
          value={state.textAreaValue}
          placeholder={state.suggestedQuery}
          ref={textAreaRef}
          onKeyDown={handleKeyDown}
          onChange={handleInputChange}
          autosize
          minRows={1}
          maxRows={8}
          autoFocus
        />
        <Group gap="xs">
          {state.textAreaValue.length >= 1 ? (
            <Button
              size="xs"
              onClick={handleClearButtonClick}
              variant="default"
            >
              Clear
            </Button>
          ) : null}
          <Button size="xs" type="submit" variant="default" flex={1}>
            Search
          </Button>
          {additionalButtons}
        </Group>
      </Stack>
    </form>
  );
}
