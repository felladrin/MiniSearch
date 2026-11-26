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

let followUpSearchInvocation = 0;
let textRefreshInvocation = 0;
let imageRefreshInvocation = 0;
let pageContentsReadInvocation = 0;
const latestTextRefreshByRunId = new Map<string, number>();
const latestImageRefreshByRunId = new Map<string, number>();

/**
 * Returns the fresh results the answer is grounded on (empty when nothing came
 * back), not the merged list shown in the UI.
 */
export async function refreshTextSearchResults(
  searchQuery: string,
  resultsLimit: number,
  existingResults: TextSearchResults,
  searchRunId = getCurrentSearchRunId(),
): Promise<TextSearchResults> {
  const invocation = ++textRefreshInvocation;
  latestTextRefreshByRunId.set(searchRunId, invocation);
  const isCurrent = () =>
    invocation === textRefreshInvocation &&
    searchRunId === getCurrentSearchRunId();
  const isRunCurrent = () =>
    latestTextRefreshByRunId.get(searchRunId) === invocation;

  const { results: freshResults, stale } = await searchText(
    searchQuery,
    resultsLimit,
  );

  if (freshResults.length === 0) return [];

  const llmResults = selectLlmSearchResults(
    freshResults,
    searchResultsToConsider,
  );

  if (isCurrent()) {
    updateTextSearchStale(stale);
    updateLlmTextSearchResults(llmResults);
  }

  const existingUrls = new Set(existingResults.map(([, , url]) => url));
  const uniqueFreshResults = freshResults.filter(
    ([, , url]) => !existingUrls.has(url),
  );

  if (uniqueFreshResults.length > 0) {
    const updatedResults: TextSearchResults = [
      ...existingResults,
      ...uniqueFreshResults,
    ];

    if (isCurrent()) {
      updateTextSearchResults(updatedResults);
    }

    if (isRunCurrent()) {
      updateSearchResults(searchRunId, {
        type: "text",
        items: updatedResults.map(([title, snippet, url]) => ({
          title,
          url,
          snippet,
        })),
      } satisfies TextResults);
    }
  }

  return isCurrent() ? llmResults : [];
}

export async function refreshImageSearchResults(
  searchQuery: string,
  resultsLimit: number,
  existingResults: ImageSearchResults,
  searchRunId = getCurrentSearchRunId(),
): Promise<void> {
  const invocation = ++imageRefreshInvocation;
  latestImageRefreshByRunId.set(searchRunId, invocation);
  const isCurrent = () =>
    invocation === imageRefreshInvocation &&
    searchRunId === getCurrentSearchRunId();
  const isRunCurrent = () =>
    latestImageRefreshByRunId.get(searchRunId) === invocation;

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

    if (isCurrent()) {
      updateImageSearchResults(updatedImageResults);
    }

    if (isRunCurrent()) {
      updateSearchResults(searchRunId, {
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
  const invocation = ++pageContentsReadInvocation;
  const contents: PageContents = await fetchPageContents(
    searchQuery,
    results.map(([, , url]) => url),
  );

  // A newer search or follow-up has already started; its pages own the channel now.
  if (
    invocation !== pageContentsReadInvocation ||
    getCurrentSearchRunId() !== searchRunId
  ) {
    return;
  }

  if (Object.keys(contents).length === 0) return;

  updatePageContents({ ...getPageContents(), ...contents });
}

export async function persistChatMessages(
  query: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  await saveChatMessageForQuery(query, "user", userMessage);
  await saveChatMessageForQuery(query, "assistant", assistantMessage);
}

export async function runFollowUpSearch(
  messages: ChatMessage[],
  currentInput: string,
  settings: Settings,
  existingTextResults: TextSearchResults,
  existingImageResults: ImageSearchResults,
): Promise<void> {
  const searchRunId = getCurrentSearchRunId();
  const followUpInvocation = ++followUpSearchInvocation;
  const isFollowUpCurrent = () =>
    followUpInvocation === followUpSearchInvocation &&
    searchRunId === getCurrentSearchRunId();

  const { generateRelatedSearchQuery } = await import("./relatedSearchQuery");
  const relatedQuery = await generateRelatedSearchQuery([...messages]);
  if (!isFollowUpCurrent()) return;

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

  let pageContentsRead = Promise.resolve();

  if (settings.enableTextSearch) {
    try {
      const freshResults = await refreshTextSearchResults(
        searchQuery,
        settings.searchResultsLimit,
        existingTextResults,
        searchRunId,
      );

      if (
        freshResults.length > 0 &&
        settings.enablePageContentFetch &&
        isFollowUpCurrent()
      ) {
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

  if (settings.enableImageSearch && isFollowUpCurrent()) {
    refreshImageSearchResults(
      searchQuery,
      settings.searchResultsLimit,
      existingImageResults,
      searchRunId,
    ).catch((error) => {
      addLogEntry(`Error in follow-up image search: ${error}`);
    });
  }

  await pageContentsRead;
}
