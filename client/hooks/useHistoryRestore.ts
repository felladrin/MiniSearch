import { useCallback } from "react";
import { useLocation } from "wouter";
import type { SearchEntry } from "../modules/history";
import {
  getChatMessagesForQuery,
  getLatestLlmResponseForEntry,
  getResultsFromEntry,
  hasImageResults,
  hasTextResults,
  setCurrentSearchRunId,
} from "../modules/history";
import { postMessageToParentWindow } from "../modules/parentWindow";
import {
  updateChatInput,
  updateChatMessages,
  updateFollowUpQuestion,
  updateImageSearchResults,
  updateImageSearchState,
  updateIsRestoringFromHistory,
  updateLlmTextSearchResults,
  updatePageContents,
  updateResponse,
  updateSuppressNextFollowUp,
  updateTextGenerationState,
  updateTextSearchResults,
  updateTextSearchState,
} from "../modules/pubSub";
import type { ImageSearchResults, TextSearchResults } from "../modules/types";

/** Restores a full search (results, AI response, chat) from a history entry and navigates to it. */
export function useHistoryRestore(
  updateQuery: (query: string) => void,
  textAreaRef?: React.RefObject<HTMLTextAreaElement | null>,
) {
  const [, navigate] = useLocation();

  const restoreSearch = useCallback(
    async (entry: SearchEntry) => {
      const selectedQuery = entry.query;
      updateQuery(selectedQuery);

      const searchRunId = entry.searchRunId || entry.query;
      setCurrentSearchRunId(searchRunId);

      updateIsRestoringFromHistory(true);
      updateSuppressNextFollowUp(true);
      // Excerpts belong to the search that fetched them; a follow-up on the
      // restored entry must not be grounded on the live search's pages.
      updatePageContents({});
      updateFollowUpQuestion("");
      updateChatInput("");

      const queryString = `q=${encodeURIComponent(selectedQuery)}`;
      postMessageToParentWindow({ queryString, hash: "" });
      navigate(`/?${queryString}`, { replace: true });

      document.title = selectedQuery;

      if (hasTextResults(entry)) {
        const results = getResultsFromEntry(entry);
        if (results && results.type === "text") {
          const textTuples: TextSearchResults = results.items.map((it) => [
            it.title,
            it.snippet,
            it.url,
          ]);
          updateTextSearchResults(textTuples);
          updateTextSearchState("completed");
          updateLlmTextSearchResults(textTuples);
        } else {
          updateTextSearchResults([]);
          updateTextSearchState("completed");
          updateLlmTextSearchResults([]);
        }
      } else {
        updateTextSearchResults([]);
        updateTextSearchState("completed");
        updateLlmTextSearchResults([]);
      }

      if (hasImageResults(entry)) {
        const results = getResultsFromEntry(entry);
        if (results && results.type === "image") {
          const imageTuples: ImageSearchResults = results.items.map((it) => [
            it.title,
            it.url,
            it.thumbnail,
            it.sourceUrl || "",
          ]);
          updateImageSearchResults(imageTuples);
          updateImageSearchState("completed");
        } else {
          updateImageSearchResults([]);
          updateImageSearchState("completed");
        }
      } else {
        updateImageSearchResults([]);
        updateImageSearchState("completed");
      }

      const savedResponse = await getLatestLlmResponseForEntry(entry);
      if (savedResponse && savedResponse.trim().length > 0) {
        updateResponse(savedResponse);
        updateTextGenerationState("completed");
      } else {
        updateResponse("");
        updateTextGenerationState("idle");
      }

      updateChatMessages([]);
      const chatMessages = await getChatMessagesForQuery(searchRunId);
      updateChatMessages(chatMessages);

      updateFollowUpQuestion("");

      setTimeout(() => {
        updateIsRestoringFromHistory(false);
      }, 0);

      textAreaRef?.current?.focus();
    },
    [updateQuery, navigate, textAreaRef],
  );

  return { restoreSearch };
}
