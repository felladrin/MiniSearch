import { Button, Group, Stack, Textarea } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import DictationButton, {
  dictationButtonWidth,
} from "@/components/DictationButton";
import { useHistoryRestore } from "@/hooks/useHistoryRestore";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { isQueryHandled, markQueryAsHandled } from "@/modules/autoSearch";
import { resetSearchRunId } from "@/modules/history";
import { handleEnterKeyDown } from "@/modules/keyboard";
import { addLogEntry } from "@/modules/logEntries";
import { postMessageToParentWindow } from "@/modules/parentWindow";
import { isRestoringFromHistoryPubSub, settingsPubSub } from "@/modules/pubSub";
import {
  DEFAULT_QUERY_SUGGESTION,
  getRandomQuerySuggestion,
} from "@/modules/querySuggestions";
import { sleepUntilIdle } from "@/modules/sleep";
import { searchAndRespond } from "@/modules/textGeneration";
import HistoryButton from "../History/HistoryButton";

/** Keeps the query text off the dictation button that floats over it. */
const dictationGutter = 4;

function getUrlQuery() {
  return new URLSearchParams(window.location.search).get("q");
}

interface SearchFormState {
  textAreaValue: string;
  suggestedQuery: string;
}

export default memo(function SearchForm({
  query,
  updateQuery,
  additionalButtons,
}: {
  query: string;
  updateQuery: (query: string) => void;
  additionalButtons?: ReactNode;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * The text the dictation button last asked for, held until React has
   * committed it. `getDictationBase` reads the DOM, which trails the state by
   * one commit, and the button strips its previous transcript out of what it
   * reads before appending the new one. Read a stale value and that strip
   * misses, so the whole transcript gets appended again on top of itself.
   * Cleared after every commit, so typing, Clear and history restore take over
   * as soon as the DOM disagrees with what dictation last wrote.
   */
  const pendingDictationRef = useRef<string | null>(null);
  useEffect(() => {
    pendingDictationRef.current = null;
  });
  const [state, setState] = useState<SearchFormState>({
    textAreaValue: query,
    suggestedQuery: DEFAULT_QUERY_SUGGESTION,
  });
  const [dictationSessionKey, setDictationSessionKey] = useState(0);

  const [, navigate] = useLocation();
  const [pubSubSettings] = usePubSub(settingsPubSub);
  const [isRestoringFromHistory] = usePubSub(isRestoringFromHistoryPubSub);
  const { addToHistory } = useSearchHistory();
  const { restoreSearch } = useHistoryRestore((newQuery) => {
    setState((prev) => ({ ...prev, textAreaValue: newQuery }));
    updateQuery(newQuery);
  }, textAreaRef);
  const fetchQuerySuggestion = useCallback(async () => {
    try {
      return await getRandomQuerySuggestion();
    } catch {
      return DEFAULT_QUERY_SUGGESTION;
    }
  }, []);

  useEffect(() => {
    const initializeComponent = async () => {
      const urlQuery = getUrlQuery();
      const normalizedUrlQuery = urlQuery?.trim();

      if (
        urlQuery &&
        normalizedUrlQuery &&
        !isQueryHandled(normalizedUrlQuery) &&
        !isRestoringFromHistory
      ) {
        markQueryAsHandled(normalizedUrlQuery);
        updateQuery(urlQuery);
        setState((prevState) => ({
          ...prevState,
          textAreaValue: urlQuery,
        }));
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
  }, [updateQuery, isRestoringFromHistory, addToHistory]);

  // The only place a suggestion is taken when the field empties, whether by
  // typing or by Clear. An answer that arrives after the field was filled again
  // is dropped, so it cannot replace a newer one.
  useEffect(() => {
    if (state.textAreaValue.length !== 0) return;

    let isCurrent = true;
    fetchQuerySuggestion()
      .then((suggestion) => {
        if (isCurrent)
          setState((prev) => ({ ...prev, suggestedQuery: suggestion }));
      })
      .catch(() => {
        if (isCurrent)
          setState((prev) => ({
            ...prev,
            suggestedQuery: DEFAULT_QUERY_SUGGESTION,
          }));
      });

    return () => {
      isCurrent = false;
    };
  }, [state.textAreaValue.length, fetchQuerySuggestion]);

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;

    setState((prev) => ({ ...prev, textAreaValue: text }));
  };

  const handleClearButtonClick = () => {
    textAreaRef.current?.focus();
    setState((prev) => ({
      ...prev,
      textAreaValue: "",
    }));
    addLogEntry("User cleaned the search query field");
  };

  // Stable identities, so `memo` on the dictation button actually holds.
  const getDictationBase = useCallback(
    () => pendingDictationRef.current ?? textAreaRef.current?.value ?? "",
    [],
  );
  const setDictatedText = useCallback((text: string) => {
    pendingDictationRef.current = text;
    setState((prev) => ({ ...prev, textAreaValue: text }));
  }, []);

  const startSearching = useCallback(async () => {
    const queryToEncode =
      state.textAreaValue.trim().length >= 1
        ? state.textAreaValue
        : state.suggestedQuery;
    const normalizedQuery = queryToEncode.trim();

    if (normalizedQuery.length > 0) {
      markQueryAsHandled(normalizedQuery);
    }

    setDictationSessionKey((key) => key + 1);
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
    handleEnterKeyDown(event, pubSubSettings, startSearching);
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ width: "100%", position: "relative" }}
    >
      <Stack gap="xs">
        {/* Anchored to the field rather than to the form, so the button keeps
            its place when the button row below it changes height. */}
        <div style={{ position: "relative" }}>
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
            styles={{
              input: { paddingRight: dictationButtonWidth + dictationGutter },
            }}
          />
          <DictationButton
            key={dictationSessionKey}
            getValue={getDictationBase}
            setValue={setDictatedText}
            labelScope="the search query"
          />
        </div>
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
});
