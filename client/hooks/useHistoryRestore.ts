import { useCallback } from "react";
import { useLocation } from "wouter";
import type { SearchEntry } from "../modules/history";
import {
  getChatMessagesForQuery,
  getLatestLlmResponseForEntry,
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
  updateResponse,
  updateSuppressNextFollowUp,
  updateTextGenerationState,
  updateTextSearchResults,
  updateTextSearchState,
} from "../modules/pubSub";
import type { ImageSearchResults, TextSearchResults } from "../modules/types";

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
      updateFollowUpQuestion("");
      updateChatInput("");

      const queryString = `q=${encodeURIComponent(selectedQuery)}`;
      postMessageToParentWindow({ queryString, hash: "" });
      navigate(`/?${queryString}`, { replace: true });

      document.title = selectedQuery;

      if (entry.textResults) {
        const textTuples: TextSearchResults = entry.textResults.items.map(
          (it) => [it.title, it.snippet, it.url],
        );
        updateTextSearchResults(textTuples);
        updateTextSearchState("completed");
        updateLlmTextSearchResults(textTuples);
      } else {
        updateTextSearchResults([]);
        updateTextSearchState("completed");
        updateLlmTextSearchResults([]);
      }

      if (entry.imageResults) {
        const imageTuples: ImageSearchResults = entry.imageResults.items.map(
          (it) => [it.title, it.url, it.thumbnailUrl, it.sourceUrl],
        );
        updateImageSearchResults(imageTuples);
        updateImageSearchState("completed");
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
