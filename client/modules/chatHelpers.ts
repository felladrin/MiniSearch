import { normalizeFollowUpDates } from "@shared/relativeDates";
import {
  getCurrentSearchRunId,
  type ImageResults,
  saveChatMessageForQuery,
  type TextResults,
  updateSearchResults,
} from "./history";
import { addLogEntry } from "./logEntries";
import { fetchPageContents } from "./pageContent";
import {
  getPageContents,
  updateImageSearchResults,
  updateLlmTextSearchResults,
  updatePageContents,
  updateTextSearchResults,
  updateTextSearchStale,
} from "./pubSub";
import { searchImages, searchText } from "./search";
import { selectLlmSearchResults } from "./searchResultSelection";
import type { defaultSettings } from "./settings";
import { searchResultsToConsider } from "./textGenerationUtilities";
import type {
  ChatMessage,
  ImageSearchResults,
  PageContents,
  TextSearchResults,
} from "./types";

type Settings = typeof defaultSettings;

/**
 * Fetches fresh text search results and merges them into existing results,
 * deduplicating by URL. Updates pubSub state for both LLM-visible and UI results.
 *
 * Returns the results the answer is grounded on (empty when nothing came back).
 */
export async function refreshTextSearchResults(
  searchQuery: string,
  resultsLimit: number,
  existingResults: TextSearchResults,
): Promise<TextSearchResults> {
  const { results: freshResults, stale } = await searchText(
    searchQuery,
    resultsLimit,
  );

  if (freshResults.length === 0) return [];

  updateTextSearchStale(stale);

  const llmResults = selectLlmSearchResults(
    freshResults,
    searchResultsToConsider,
  );
  updateLlmTextSearchResults(llmResults);

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

  return llmResults;
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
  const { results: imageResults } = await searchImages(
    searchQuery,
    resultsLimit,
  );

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
 * Reads the pages behind the fresh follow-up results.
 *
 * The first search reads its pages before answering, but the follow-up path
 * only replaced the snippets: the new results arrived without page text, so
 * the answer fell back to titles and snippets, and a URL both searches
 * returned kept the excerpt picked for the previous question. Reading them
 * here keeps the answer grounded on the same kind of evidence for both
 * questions.
 */
async function readFollowUpPageContents(
  searchQuery: string,
  results: TextSearchResults,
  searchRunId: string,
): Promise<void> {
  const contents: PageContents = await fetchPageContents(
    searchQuery,
    results.map(([, , url]) => url),
  );

  // A newer search has already started; its pages own the channel now.
  if (getCurrentSearchRunId() !== searchRunId) return;

  if (Object.keys(contents).length === 0) return;

  updatePageContents({ ...getPageContents(), ...contents });
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
  // Same anchor as the first search in `startTextSearch`: "next month" names no
  // year to the engine, and only this machine's clock knows which one is meant.
  const searchQuery = normalizeFollowUpDates(
    relatedQuery || currentInput,
    messages
      .filter(({ role }) => role === "user")
      .map(({ content }) => content),
    new Date(),
    { maxLength: 2000 },
  ).searchQuery;

  const searchRunId = getCurrentSearchRunId();
  let pageContentsRead = Promise.resolve();

  if (settings.enableTextSearch) {
    try {
      const freshResults = await refreshTextSearchResults(
        searchQuery,
        settings.searchResultsLimit,
        existingTextResults,
      );

      if (freshResults.length > 0 && settings.enablePageContentFetch) {
        // Started here but awaited last, as in the first search, so the image
        // refresh below does not wait on the pages.
        pageContentsRead = readFollowUpPageContents(
          searchQuery,
          freshResults,
          searchRunId,
        );
      }
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

  await pageContentsRead;
}
