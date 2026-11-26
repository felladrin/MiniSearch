import { normalizeFollowUpDates } from "@shared/relativeDates";
import {
  getCurrentSearchRunId,
  type ImageResults,
  replaceChatConversation,
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
 * Returns the fresh results the answer is grounded on (empty when nothing came
 * back), not the merged list shown in the UI.
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
 * Reads the follow-up results' pages, as the first search does, so the answer
 * is not left with titles and snippets, and a URL both searches returned gets
 * an excerpt picked for the new question.
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
 * Stores a search's follow-up conversation as it now stands. The caller passes
 * the search run id it captured when the change began, so an answer that
 * arrives after a new search started is still saved under its own search.
 */
export async function persistChatConversation(
  conversationId: string,
  followUpMessages: ReadonlyArray<{
    role: "user" | "assistant";
    content: string;
  }>,
): Promise<void> {
  await replaceChatConversation(conversationId, followUpMessages);
}

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
