import { useCallback } from "react";
import { useLocation } from "wouter";
import { markQueryAsHandled } from "../modules/autoSearch";
import type { SearchEntry } from "../modules/history";
import {
  getChatMessagesForQuery,
  getCurrentSearchRunId,
  getLatestLlmResponseForEntry,
  getResultsFromEntry,
  hasImageResults,
  hasTextResults,
  setCurrentSearchRunId,
} from "../modules/history";
import { postMessageToParentWindow } from "../modules/parentWindow";
import {
  getChatGenerationState,
  updateChatInput,
  updateChatMessages,
  updateFollowUpQuestion,
  updateImageSearchResults,
  updateImageSearchState,
  updateIsRestoringFromHistory,
  updateLlmTextSearchResults,
  updatePageContents,
  updateResponseImmediately,
  updateSuppressNextFollowUp,
  updateTextGenerationState,
  updateTextSearchResults,
  updateTextSearchStale,
  updateTextSearchState,
} from "../modules/pubSub";
import { cancelSearchAnswer } from "../modules/textGeneration";
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
      // The URL is about to hold this query; without the mark, an entry that
      // restores empty would fall through to the URL auto-search once
      // isRestoringFromHistory flips back, appending a duplicate history
      // entry and starting a live search.
      markQueryAsHandled(selectedQuery);
      updateQuery(selectedQuery);

      // A live answer would keep streaming over the restored one, and save
      // itself under the restored entry.
      cancelSearchAnswer();

      const searchRunId = entry.searchRunId || entry.query;
      // Restoring the search already on screen leaves its chat mounted, so a
      // follow-up still being answered keeps going and saves its turn when it
      // lands. The stored list read below would not have that turn, and
      // publishing it would reset the chat to the shorter list, which the next
      // send then saves over storage. That chat already shows this search's
      // conversation, so it is left as it is.
      const keepsChat =
        searchRunId === getCurrentSearchRunId() &&
        getChatGenerationState().isGeneratingResponse;
      setCurrentSearchRunId(searchRunId);

      updateIsRestoringFromHistory(true);
      // Excerpts belong to the search that fetched them; a follow-up on the
      // restored entry must not be grounded on the live search's pages.
      updatePageContents({});
      updateFollowUpQuestion("");
      updateChatInput("");
      updateTextSearchStale(false);

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
        const results =
          entry.imageResults ??
          (entry.results?.type === "image" ? entry.results : null);
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
        updateSuppressNextFollowUp(true);
        // The restore publishes the whole stored answer at once; a throttled
        // write could be overwritten by whatever was queued before it.
        updateResponseImmediately(savedResponse);
        updateTextGenerationState("completed");
      } else {
        updateSuppressNextFollowUp(false);
        updateResponseImmediately("");
        updateTextGenerationState("idle");
      }

      if (!keepsChat) {
        updateChatMessages([]);
        const chatMessages = await getChatMessagesForQuery(searchRunId);
        updateChatMessages(chatMessages);
      }

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
