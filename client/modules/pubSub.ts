import { createPubSub } from "create-pubsub";
import throttle from "throttleit";
import { addLogEntry } from "./logEntries";
import { defaultSettings } from "./settings";
import type {
  ImageSearchResults,
  SearchResults,
  SearchState,
  TextGenerationState,
  TextSearchResults,
} from "./types";

/**
 * Creates a PubSub instance that persists data to localStorage
 * @param localStorageKey - The key to use for localStorage storage
 * @param defaultValue - The default value if no localStorage value exists
 * @returns A PubSub instance with localStorage persistence
 */
function createLocalStoragePubSub<T>(localStorageKey: string, defaultValue: T) {
  const localStorageValue = localStorage.getItem(localStorageKey);
  const localStoragePubSub = createPubSub(
    localStorageValue ? (JSON.parse(localStorageValue) as T) : defaultValue,
  );

  const [, onValueChange] = localStoragePubSub;

  onValueChange((value) =>
    localStorage.setItem(localStorageKey, JSON.stringify(value)),
  );

  return localStoragePubSub;
}

/**
 * PubSub instance for managing query suggestions with localStorage persistence
 */
const querySuggestionsPubSub = createLocalStoragePubSub<string[]>(
  "querySuggestions",
  [],
);

/**
 * PubSub instance for managing the last search token hash with localStorage persistence
 */
const lastSearchTokenHashPubSub = createLocalStoragePubSub(
  "lastSearchTokenHash",
  "",
);

/**
 * Updates the last search token hash
 */
export const [updateLastSearchTokenHash, , getLastSearchTokenHash] =
  lastSearchTokenHashPubSub;

/**
 * Updates query suggestions
 */
export const [updateQuerySuggestions, , getQuerySuggestions] =
  querySuggestionsPubSub;

/**
 * PubSub instance for managing the current search query
 */
export const queryPubSub = createPubSub(
  new URLSearchParams(self.location.search).get("q") ?? "",
);

export const [, , getQuery] = queryPubSub;

/**
 * PubSub instance for managing the AI response content
 */
export const responsePubSub = createPubSub("");

/**
 * Throttled function to update the response content (12 updates per second)
 */
export const updateResponse = throttle(responsePubSub[0], 1000 / 12);
export const [, , getResponse] = responsePubSub;

/**
 * PubSub instance for managing reasoning content
 */
export const reasoningContentPubSub = createPubSub("");

/**
 * Throttled function to update reasoning content (12 updates per second)
 */
export const updateReasoningContent = throttle(
  reasoningContentPubSub[0],
  1000 / 12,
);
export const [, , getReasoningContent] = reasoningContentPubSub;

/**
 * PubSub instance for managing the search promise
 */
export const [updateSearchPromise, , getSearchPromise] = createPubSub<
  Promise<SearchResults>
>(Promise.resolve({ textResults: [], imageResults: [] }));

/**
 * PubSub instance for managing text generation state
 */
export const textGenerationStatePubSub =
  createPubSub<TextGenerationState>("idle");

/**
 * Updates the text generation state
 */
export const [updateTextGenerationState, , getTextGenerationState] =
  textGenerationStatePubSub;

const [, listenToTextGenerationStateChanges] = textGenerationStatePubSub;

listenToTextGenerationStateChanges((textGenerationState) => {
  addLogEntry(`Text generation state changed to '${textGenerationState}'`);
});

/**
 * PubSub instance for managing model loading progress
 */
export const modelLoadingProgressPubSub = createPubSub(0);

/**
 * Updates the model loading progress
 */
export const [updateModelLoadingProgress] = modelLoadingProgressPubSub;

/**
 * PubSub instance for managing application settings with localStorage persistence
 */
export const settingsPubSub = createLocalStoragePubSub(
  "settings",
  defaultSettings,
);

export const [, listenToSettingsChanges, getSettings] = settingsPubSub;

/**
 * PubSub instance for managing model size in megabytes
 */
export const modelSizeInMegabytesPubSub = createPubSub(0);

/**
 * Updates the model size in megabytes
 */
export const [updateModelSizeInMegabytes] = modelSizeInMegabytesPubSub;

/**
 * PubSub instance for managing text search state
 */
export const textSearchStatePubSub = createPubSub<SearchState>("idle");
/**
 * PubSub instance for managing image search state
 */
export const imageSearchStatePubSub = createPubSub<SearchState>("idle");

/**
 * Updates the text search state
 */
export const [updateTextSearchState] = textSearchStatePubSub;

const [, subscribeToTextSearchState] = textSearchStatePubSub;

subscribeToTextSearchState((textSearchState) => {
  addLogEntry(`Text search state changed to '${textSearchState}'`);
});

/**
 * Updates the image search state
 */
export const [updateImageSearchState] = imageSearchStatePubSub;

const [, subscribeToImageSearchState] = imageSearchStatePubSub;

subscribeToImageSearchState((imageSearchState) => {
  addLogEntry(`Image search state changed to '${imageSearchState}'`);
});

/**
 * PubSub instance for managing text search results
 */
export const textSearchResultsPubSub = createPubSub<TextSearchResults>([]);

/**
 * PubSub instance for managing LLM-generated text search results
 */
const llmTextSearchResultsPubSub = createPubSub<TextSearchResults>([]);

/**
 * PubSub instance for managing image search results
 */
export const imageSearchResultsPubSub = createPubSub<ImageSearchResults>([]);

/**
 * Updates text search results
 */
export const [updateTextSearchResults] = textSearchResultsPubSub;

/**
 * Updates LLM text search results
 */
export const [updateLlmTextSearchResults, , getLlmTextSearchResults] =
  llmTextSearchResultsPubSub;

/**
 * Updates image search results
 */
export const [updateImageSearchResults] = imageSearchResultsPubSub;

/**
 * PubSub instance for managing expanded menu accordions with localStorage persistence
 */
export const menuExpandedAccordionsPubSub = createLocalStoragePubSub<string[]>(
  "menuExpandedAccordions",
  [],
);

/**
 * PubSub instance for managing chat input content
 */
export const chatInputPubSub = createPubSub("");

/**
 * Updates chat input content
 */
export const [updateChatInput] = chatInputPubSub;

/**
 * PubSub instance for managing chat generation state
 */
export const chatGenerationStatePubSub = createPubSub({
  isGeneratingResponse: false,
  isGeneratingFollowUpQuestion: false,
});

/**
 * PubSub instance for managing follow-up questions
 */
export const followUpQuestionPubSub = createPubSub("");

/**
 * Updates follow-up question
 */
export const [updateFollowUpQuestion] = followUpQuestionPubSub;

/**
 * PubSub instance for managing conversation summary
 */
const conversationSummaryPubSub = createPubSub({
  conversationId: "",
  summary: "",
});

/**
 * Updates conversation summary
 */
export const [updateConversationSummary, , getConversationSummary] =
  conversationSummaryPubSub;

/**
 * PubSub instance for managing chat messages
 */
export const chatMessagesPubSub = createPubSub<
  Array<{ role: "user" | "assistant"; content: string }>
>([]);

/**
 * Updates chat messages
 */
export const [updateChatMessages] = chatMessagesPubSub;

/**
 * PubSub instance for managing history restoration state
 */
export const isRestoringFromHistoryPubSub = createPubSub(false);

/**
 * Updates history restoration state
 */
export const [updateIsRestoringFromHistory] = isRestoringFromHistoryPubSub;

/**
 * PubSub instance for managing follow-up question suppression
 */
export const suppressNextFollowUpPubSub = createPubSub(false);

/**
 * Updates follow-up question suppression state
 */
export const [updateSuppressNextFollowUp, , getSuppressNextFollowUp] =
  suppressNextFollowUpPubSub;
