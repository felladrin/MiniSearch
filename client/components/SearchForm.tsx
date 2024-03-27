import { useEffect, useRef, FormEvent, useState, useCallback } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { searchQueryKey } from "../modules/search";
import { getRandomQuerySuggestion } from "../modules/querySuggestions";

export function SearchForm() {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestedQuery, setSuggestedQuery] = useState<string>(() => {
    const previousSearchQuery = localStorage.getItem(searchQueryKey) ?? "";

    localStorage.removeItem(searchQueryKey);

    return previousSearchQuery === ""
      ? getRandomQuerySuggestion()
      : previousSearchQuery;
  });

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const userQueryIsBlank = event.target.value.trim().length === 0;
    const suggestedQueryIsBlank = suggestedQuery.trim().length === 0;

    if (userQueryIsBlank && suggestedQueryIsBlank) {
      setSuggestedQuery(getRandomQuerySuggestion());
    } else if (!userQueryIsBlank && !suggestedQueryIsBlank) {
      setSuggestedQuery("");
    }
  };

  const startSearching = useCallback(() => {
    let queryToEncode = suggestedQuery;

    if (textAreaRef.current && textAreaRef.current.value.trim().length > 0) {
      queryToEncode = textAreaRef.current.value;
    }

    window.location.href = `./?q=${encodeURIComponent(queryToEncode)}`;
  }, [suggestedQuery]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startSearching();
  };

  useEffect(() => {
    const keyboardEventHandler = (event: KeyboardEvent) => {
      if (event.code === "Enter" && !event.shiftKey) {
        event.preventDefault();
        startSearching();
      }
    };
    const textArea = textAreaRef.current;
    textArea?.addEventListener("keypress", keyboardEventHandler);
    return () => {
      textArea?.removeEventListener("keypress", keyboardEventHandler);
    };
  }, [startSearching]);

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <TextareaAutosize
        placeholder={suggestedQuery}
        ref={textAreaRef}
        onChange={handleInputChange}
        autoFocus
        minRows={1}
        maxRows={6}
      />
      <button type="submit" style={{ width: "100%" }}>
        Submit
      </button>
    </form>
  );
}
