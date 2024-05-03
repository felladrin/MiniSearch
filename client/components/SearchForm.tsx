import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from 'react-router-dom';
import TextareaAutosize from "react-textarea-autosize";
import { getRandomQuerySuggestion } from "../modules/querySuggestions";
import { debounce } from "../utils/debounce";

export function SearchForm({
  query,
  updateQuery,
}: {
  query: string;
  updateQuery: (query: string) => void;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const windowInnerHeight = useWindowInnerHeight();
  const [suggestedQuery, setSuggestedQuery] = useState<string>(
    getRandomQuerySuggestion(),
  );

const navigate = useNavigate();

const startSearching = useCallback((queryToEncode: string) => {
   updateQuery(queryToEncode);
   navigate(`/?q=${encodeURIComponent(queryToEncode)}`);
 }, [updateQuery, navigate]);

  const debouncedStartSearching = debounce(startSearching, 3000); // 3000ms = 3s

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const userQuery = event.target.value.trim();
    const userQueryIsBlank = userQuery.length === 0;
    const suggestedQueryIsBlank = suggestedQuery.trim().length === 0;
  
    if (userQueryIsBlank && suggestedQueryIsBlank) {
      setSuggestedQuery(getRandomQuerySuggestion());
    } else if (!userQueryIsBlank && !suggestedQueryIsBlank) {
      setSuggestedQuery("");
    }
  
    // Start searching immediately when user types
    if (!userQueryIsBlank) {
      debouncedStartSearching(userQuery);
    }
  };

  useEffect(() => {
    const keyboardEventHandler = (event: KeyboardEvent) => {
      if (event.code === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (textAreaRef.current) {
          const userQuery = textAreaRef.current.value.trim();
          if (userQuery.length > 0) {
            startSearching(userQuery);
          }
        }
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
      <form style={{ width: "100%" }}>
        <TextareaAutosize
          defaultValue={query}
          placeholder={suggestedQuery}
          ref={textAreaRef}
          onChange={handleInputChange}
          autoFocus
          minRows={1}
          maxRows={6}
        />
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
