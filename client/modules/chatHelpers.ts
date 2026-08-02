import {
  getCurrentSearchRunId,
  type ImageResults,
  saveChatMessageForQuery,
  type TextResults,
  updateSearchResults,
} from "./history";
import { addLogEntry } from "./logEntries";
import {
  updateImageSearchResults,
  updateLlmTextSearchResults,
  updateTextSearchResults,
} from "./pubSub";
import { searchImages, searchText } from "./search";
import type { defaultSettings } from "./settings";
import { searchResultsToConsider } from "./textGenerationUtilities";
import type {
  ChatMessage,
  ImageSearchResults,
  TextSearchResults,
} from "./types";

type Settings = typeof defaultSettings;

/**
 * Fetches fresh text search results and merges them into existing results,
 * deduplicating by URL. Updates pubSub state for both LLM-visible and UI results.
 */
export async function refreshTextSearchResults(
  searchQuery: string,
  resultsLimit: number,
  existingResults: TextSearchResults,
): Promise<void> {
  const freshResults = await searchText(searchQuery, resultsLimit);

  if (freshResults.length === 0) return;

  updateLlmTextSearchResults(freshResults.slice(0, searchResultsToConsider));

  const existingUrls = new Set(existingResults.map(([, , url]) => url));
  const uniqueFreshResults = freshResults.filter(
    ([, , url]) => !existingUrls.has(url),
  );

  if (uniqueFreshResults.length > 0) {
    const updatedResults: TextSearchResults = [
      ...existingResults,
      ...uniqueFreshResults,
    ];
    updateTextSearchResults(updatedResults);

    updateSearchResults(getCurrentSearchRunId(), {
      type: "text",
      items: updatedResults.map(([title, snippet, url]) => ({
        title,
        url,
        snippet,
      })),
    } satisfies TextResults);
  }
}

/**
 * Fetches fresh image search results and merges them into existing results,
 * deduplicating by URL. Fire-and-forget (returns Promise, caller catches errors).
 */
export async function refreshImageSearchResults(
  searchQuery: string,
  resultsLimit: number,
  existingResults: ImageSearchResults,
): Promise<void> {
  const imageResults = await searchImages(searchQuery, resultsLimit);

  if (imageResults.length === 0) return;

  const existingUrls = new Set(existingResults.map(([, url]) => url));
  const uniqueFreshResults = imageResults.filter(
    ([, url]) => !existingUrls.has(url),
  );

  if (uniqueFreshResults.length > 0) {
    const updatedImageResults: ImageSearchResults = [
      ...uniqueFreshResults,
      ...existingResults,
    ];
    updateImageSearchResults(updatedImageResults);

    updateSearchResults(getCurrentSearchRunId(), {
      type: "image",
      items: updatedImageResults.map(
        ([title, url, thumbnailUrl, sourceUrl]) => ({
          title,
          url,
          thumbnail: thumbnailUrl,
          sourceUrl,
        }),
      ),
    } satisfies ImageResults);
  }
}

/**
 * Saves a user message and its assistant response to chat history.
 */
export async function persistChatMessages(
  query: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  await saveChatMessageForQuery(query, "user", userMessage);
  await saveChatMessageForQuery(query, "assistant", assistantMessage);
}

/**
 * Runs the follow-up search phase: generates a related search query from chat
 * history, then refreshes text and image results with deduplication.
 */
export async function runFollowUpSearch(
  messages: ChatMessage[],
  currentInput: string,
  settings: Settings,
  existingTextResults: TextSearchResults,
  existingImageResults: ImageSearchResults,
): Promise<void> {
  const { generateRelatedSearchQuery } = await import("./relatedSearchQuery");
  const relatedQuery = await generateRelatedSearchQuery([...messages]);
  const searchQuery = relatedQuery || currentInput;

  if (settings.enableTextSearch) {
    try {
      await refreshTextSearchResults(
        searchQuery,
        settings.searchResultsLimit,
        existingTextResults,
      );
    } catch (error) {
      addLogEntry(`Error in follow-up search: ${error}`);
    }
  }

  if (settings.enableImageSearch) {
    refreshImageSearchResults(
      searchQuery,
      settings.searchResultsLimit,
      existingImageResults,
    ).catch((error) => {
      addLogEntry(`Error in follow-up image search: ${error}`);
    });
  }
}
