import { useEffect, useRef, FormEvent, useState, useCallback } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { getRandomQuerySuggestion } from "../modules/querySuggestions";
import { SettingsButton } from "./SettingsButton";
import { useLocation } from "wouter";
import { prepareTextGeneration } from "../modules/textGeneration";
import { isMatching, match, Pattern } from "ts-pattern";

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

  const style = match(query)
    .with(Pattern.string.length(0), () => ({
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: windowInnerHeight * 0.8,
    }))
    .otherwise(() => undefined);

  return (
    <div style={style}>
      <form onSubmit={handleSubmit} style={{ width: "100%" }}>
        <TextareaAutosize
          value={textAreaValue}
          placeholder={suggestedQuery}
          ref={textAreaRef}
          onKeyDown={handleKeyDown}
          onChange={handleInputChange}
          autoFocus
          minRows={1}
          maxRows={6}
        />
        <div style={{ display: "flex", width: "100%" }}>
          {match(textAreaValue)
            .with(Pattern.string.minLength(1), () => (
              <button
                type="button"
                style={{ fontSize: "small" }}
                onClick={handleClearButtonClick}
              >
                Clear
              </button>
            ))
            .otherwise(() => null)}
          <button type="submit" style={{ width: "100%", fontSize: "small" }}>
            Search
          </button>
          <SettingsButton />
        </div>
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
