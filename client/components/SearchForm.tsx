import { useEffect, useRef, FormEvent, useState, useCallback } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { getRandomQuerySuggestion } from "../modules/querySuggestions";
import { MenuButton } from "./MenuButton";
import { useLocation } from "wouter";
import { prepareTextGeneration } from "../modules/textGeneration";
import { isMatching, match, Pattern } from "ts-pattern";
import { Button, HStack, Stack, VStack } from "rsuite";

export function SearchForm({
  query,
  updateQuery,
}: {
  query: string;
  updateQuery: (query: string) => void;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [textAreaValue, setTextAreaValue] = useState(query);
  const windowInnerHeight = useWindowInnerHeight();
  const defaultSuggestedQuery = "Anything you need!";
  const [suggestedQuery, setSuggestedQuery] = useState(defaultSuggestedQuery);
  const [, navigate] = useLocation();

  useEffect(() => {
    prepareTextGeneration();
  }, []);

  useEffect(() => {
    getRandomQuerySuggestion().then((querySuggestion) => {
      setSuggestedQuery(querySuggestion);
    });
  }, []);

  const handleInputChange = async (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
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
  };

  const startSearching = useCallback(() => {
    const queryToEncode = match(textAreaValue.trim())
      .with(Pattern.string.minLength(1), () => textAreaValue)
      .otherwise(() => suggestedQuery);

    setTextAreaValue(queryToEncode);

    navigate(`/?q=${encodeURIComponent(queryToEncode)}`, { replace: true });

    updateQuery(queryToEncode);

    prepareTextGeneration();
  }, [textAreaValue, suggestedQuery, updateQuery]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startSearching();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isPressingEnterWithoutShift = isMatching<Partial<typeof event>>(
      {
        code: "Enter",
        shiftKey: false,
      },
      event,
    );

    if (isPressingEnterWithoutShift) {
      event.preventDefault();
      startSearching();
    }
  };

  return (
    <div
      style={match(query)
        .with(Pattern.string.length(0), () => ({
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: windowInnerHeight * 0.8,
        }))
        .otherwise(() => undefined)}
    >
      <form onSubmit={handleSubmit} style={{ width: "100%" }}>
        <VStack>
          <Stack.Item style={{ width: "100%" }}>
            <TextareaAutosize
              value={textAreaValue}
              placeholder={suggestedQuery}
              ref={textAreaRef}
              onKeyDown={handleKeyDown}
              onChange={handleInputChange}
              className="rs-input"
              autoFocus
              minRows={1}
              maxRows={8}
            />
          </Stack.Item>
          <Stack.Item style={{ width: "100%" }}>
            <HStack>
              {match(textAreaValue)
                .with(Pattern.string.minLength(1), () => (
                  <Stack.Item>
                    <Button size="sm" onClick={handleClearButtonClick}>
                      Clear
                    </Button>
                  </Stack.Item>
                ))
                .otherwise(() => null)}
              <Stack.Item grow={1}>
                <Button size="sm" type="submit" block>
                  Search
                </Button>
              </Stack.Item>
              <Stack.Item>
                <MenuButton />
              </Stack.Item>
            </HStack>
          </Stack.Item>
        </VStack>
      </form>
    </div>
  );
}

function useWindowInnerHeight() {
  const [windowInnerHeight, setWindowInnerHeight] = useState(self.innerHeight);

  useEffect(() => {
    const handleResize = () => setWindowInnerHeight(self.innerHeight);

    self.addEventListener("resize", handleResize);

    return () => self.removeEventListener("resize", handleResize);
  }, []);

  return windowInnerHeight;
}
