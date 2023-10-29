import { useEffect, useRef, FormEvent } from "react";
import { searchQueryKey } from "../modules/search";

export function SearchForm() {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const searchQuery = localStorage.getItem(searchQueryKey) ?? "";

  const startSearching = () => {
    if (textAreaRef.current && textAreaRef.current.value.trim().length > 0) {
      const encodedQuery = encodeURIComponent(textAreaRef.current?.value);
      window.location.href = `./?q=${encodedQuery}`;
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    localStorage.removeItem(searchQueryKey);
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
  }, [textAreaRef]);

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <textarea
        placeholder="Anything you need!"
        ref={textAreaRef}
        defaultValue={searchQuery}
        autoFocus
      />
      <button type="submit" style={{ width: "100%", marginTop: "20px" }}>
        Submit
      </button>
    </form>
  );
}
