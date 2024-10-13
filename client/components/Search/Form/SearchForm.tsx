import {
  useEffect,
  useRef,
  useState,
  useCallback,
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import { getRandomQuerySuggestion } from "../../../modules/querySuggestions";
import { useLocation } from "wouter";
import { searchAndRespond } from "../../../modules/textGeneration";
import { match, Pattern } from "ts-pattern";
import { Button, Group, Stack, Textarea } from "@mantine/core";
import { addLogEntry } from "../../../modules/logEntries";
import { sleepUntilIdle } from "../../../modules/sleep";
import { settingsPubSub } from "../../../modules/pubSub";
import { usePubSub } from "create-pubsub/react";
import { postMessageToParentWindow } from "../../../modules/parentWindow";

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
  const [textAreaValue, setTextAreaValue] = useState(query);
  const defaultSuggestedQuery = "Anything you need!";
  const [suggestedQuery, setSuggestedQuery] = useState(defaultSuggestedQuery);
  const [, navigate] = useLocation();
  const [settings] = usePubSub(settingsPubSub);

  useEffect(() => {
    sleepUntilIdle().then(() => {
      searchAndRespond();
    });
  }, []);

  useEffect(() => {
    getRandomQuerySuggestion().then((querySuggestion) => {
      setSuggestedQuery(querySuggestion);
    });
  }, []);

  const handleInputChange = async (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;

    setTextAreaValue(text);

    if (text.length === 0) {
      setSuggestedQuery(await getRandomQuerySuggestion());
    }
  };

  const handleClearButtonClick = async () => {
    setSuggestedQuery(await getRandomQuerySuggestion());
    setTextAreaValue("");
    textAreaRef.current?.focus();
    addLogEntry("User cleaned the search query field");
  };

  const startSearching = useCallback(() => {
    const queryToEncode = match(textAreaValue.trim())
      .with(Pattern.string.minLength(1), () => textAreaValue)
      .otherwise(() => suggestedQuery);

    setTextAreaValue(queryToEncode);

    const queryString = `q=${encodeURIComponent(queryToEncode)}`;

    postMessageToParentWindow({ queryString, hash: "" });

    navigate(`/?${queryString}`, { replace: true });

    updateQuery(queryToEncode);

    searchAndRespond();

    addLogEntry(
      `User submitted a search with ${queryToEncode.length} characters length`,
    );
  }, [textAreaValue, suggestedQuery, updateQuery]);

  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    startSearching();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    match([event, settings.enterToSubmit])
      .with(
        [{ code: "Enter", shiftKey: false }, true],
        [{ code: "Enter", shiftKey: true }, false],
        () => handleSubmit(event),
      )
      .otherwise(() => undefined);
  };

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <Stack gap="xs">
        <Textarea
          value={textAreaValue}
          placeholder={suggestedQuery}
          ref={textAreaRef}
          onKeyDown={handleKeyDown}
          onChange={handleInputChange}
          autosize
          minRows={1}
          maxRows={8}
          autoFocus
        />
        <Group gap="xs">
          {match(textAreaValue)
            .with(Pattern.string.minLength(1), () => (
              <Button
                size="xs"
                onClick={handleClearButtonClick}
                variant="default"
              >
                Clear
              </Button>
            ))
            .otherwise(() => null)}
          <Button size="xs" type="submit" variant="default" flex={1}>
            Search
          </Button>
          {additionalButtons}
        </Group>
      </Stack>
    </form>
  );
}
