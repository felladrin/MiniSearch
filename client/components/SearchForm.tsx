import { useEffect, useRef, FormEvent, useState, useCallback } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { getRandomQuerySuggestion } from "../modules/querySuggestions";
import { SettingsButton } from "./SettingsButton";
import { useNavigate } from "react-router-dom";
import { prepareTextGeneration } from "../modules/textGeneration";
import { updateResponse, updateSearchResults } from "../modules/pubSub";

export function SearchForm({
  query,
  updateQuery,
}: {
  query: string;
  updateQuery: (query: string) => void;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const windowInnerHeight = useWindowInnerHeight();
  const defaultSuggestedQuery = "Anything you need!";
  const [suggestedQuery, setSuggestedQuery] = useState(defaultSuggestedQuery);
  const navigate = useNavigate();

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
    const userQueryIsBlank = event.target.value.length === 0;

    if (userQueryIsBlank) {
      setSuggestedQuery(await getRandomQuerySuggestion());
    }
  };

  const startSearching = useCallback(() => {
    let queryToEncode = suggestedQuery;

    if (textAreaRef.current && textAreaRef.current.value.trim().length > 0) {
      queryToEncode = textAreaRef.current.value;
    }

    navigate(`/?q=${encodeURIComponent(queryToEncode)}`);

    if (textAreaRef.current) {
      textAreaRef.current.value = queryToEncode;
    }

    updateQuery(queryToEncode);

    updateResponse("");

    updateSearchResults([]);

    prepareTextGeneration();
  }, [suggestedQuery, updateQuery]);

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
    <div
      style={
        query.length === 0
          ? {
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: windowInnerHeight * 0.8,
            }
          : undefined
      }
    >
      <form onSubmit={handleSubmit} style={{ width: "100%" }}>
        <TextareaAutosize
          defaultValue={query}
          placeholder={suggestedQuery}
          ref={textAreaRef}
          onChange={handleInputChange}
          autoFocus
          minRows={1}
          maxRows={6}
        />
        <div style={{ display: "flex", width: "100%" }}>
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
