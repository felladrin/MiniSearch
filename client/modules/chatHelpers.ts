import { normalizeFollowUpDates } from "@shared/relativeDates";
import {
  getCurrentSearchRunId,
  type ImageResults,
  mergeSearchImageResults,
  replaceChatConversation,
  type TextResults,
  updateSearchResults,
} from "./history";
import { addLogEntry } from "./logEntries";
import { fetchPageContents } from "./pageContent";
import {
  getImageSearchResults,
  getPageContents,
  updateImageSearchResults,
  updateLlmTextSearchResults,
  updatePageContents,
  updateTextSearchResults,
  updateTextSearchStale,
} from "./pubSub";
import { searchImages, searchText } from "./search";
import { getLatestSearchAttempt } from "./searchAttempts";
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

/**
 * True while no retry has started on the run since the call: a retry keeps the
 * run id, so a follow-up that lands after it would otherwise pass as current.
 */
function sameSearchAttempt(searchRunId: string): () => boolean {
  const attempt = getLatestSearchAttempt(searchRunId);
  return () => getLatestSearchAttempt(searchRunId) === attempt;
}
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
  const isSameAttempt = sameSearchAttempt(searchRunId);
  const isCurrent = () =>
    invocation === textRefreshInvocation &&
    searchRunId === getCurrentSearchRunId() &&
    isSameAttempt();
  const isRunCurrent = () =>
    latestTextRefreshByRunId.get(searchRunId) === invocation && isSameAttempt();

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
  const isSameAttempt = sameSearchAttempt(searchRunId);
  const isCurrent = () =>
    invocation === imageRefreshInvocation &&
    searchRunId === getCurrentSearchRunId() &&
    isSameAttempt();
  const isRunCurrent = () =>
    latestImageRefreshByRunId.get(searchRunId) === invocation &&
    isSameAttempt();

  const { results: imageResults } = await searchImages(
    searchQuery,
    resultsLimit,
  );

  if (imageResults.length === 0) return;

  // The first search's images can land after this refresh started, so it adds
  // to the list on screen now as well as the one it was handed then.
  const shown = isCurrent() ? getImageSearchResults() : [];
  const shownUrls = new Set(shown.map(([, url]) => url));
  const baseResults: ImageSearchResults = [
    ...shown,
    ...existingResults.filter(([, url]) => !shownUrls.has(url)),
  ];
  const existingUrls = new Set(baseResults.map(([, url]) => url));
  const uniqueFreshResults = imageResults.filter(
    ([, url]) => !existingUrls.has(url),
  );

  if (uniqueFreshResults.length > 0) {
    const updatedImageResults: ImageSearchResults = [
      ...uniqueFreshResults,
      ...baseResults,
    ];

    if (isCurrent()) {
      updateImageSearchResults(updatedImageResults);
    }

    if (isRunCurrent()) {
      // Off the search, the screen no longer holds this run's images, so the
      // stored list is the one to add to.
      const saveImages = isCurrent()
        ? updateSearchResults
        : mergeSearchImageResults;
      saveImages(searchRunId, {
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
  const isSameAttempt = sameSearchAttempt(searchRunId);
  const contents: PageContents = await fetchPageContents(
    searchQuery,
    results.map(([, , url]) => url),
  );

  // A newer search or follow-up has already started; its pages own the channel now.
  if (
    invocation !== pageContentsReadInvocation ||
    getCurrentSearchRunId() !== searchRunId ||
    !isSameAttempt()
  ) {
    return;
  }

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
  const searchRunId = getCurrentSearchRunId();
  const followUpInvocation = ++followUpSearchInvocation;
  const isSameAttempt = sameSearchAttempt(searchRunId);
  const isFollowUpCurrent = () =>
    followUpInvocation === followUpSearchInvocation &&
    searchRunId === getCurrentSearchRunId() &&
    isSameAttempt();

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
