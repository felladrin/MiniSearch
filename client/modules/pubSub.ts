import { createPubSub } from "create-pubsub";
import throttle from "throttleit";
import { addLogEntry } from "./logEntries";
import { defaultSettings, SETTINGS_STORAGE_KEY } from "./settings";
import type {
  ImageSearchResults,
  PageContents,
  SearchResults,
  SearchState,
  TextGenerationState,
  TextSearchResults,
} from "./types";

/**
 * Whether two values share the same JSON top-level kind (array, null, or a
 * primitive type), so a stored value is checked against the default's shape
 * before it is trusted.
 */
function isSameJsonKind(value: unknown, reference: unknown): boolean {
  if (Array.isArray(value) || Array.isArray(reference)) {
    return Array.isArray(value) === Array.isArray(reference);
  }
  if (value === null || reference === null) {
    return value === null && reference === null;
  }
  return typeof value === typeof reference;
}

function createLocalStoragePubSub<T>(localStorageKey: string, defaultValue: T) {
  const localStorageValue = localStorage.getItem(localStorageKey);
  let initialValue: T = defaultValue;
  if (localStorageValue !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(localStorageValue);
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined && isSameJsonKind(parsed, defaultValue)) {
      initialValue = parsed as T;
    } else {
      // Runs at module load, so an unparseable or wrong-type stored value must
      // not crash the app. Remove it (so the fallback doesn't repeat on every
      // load) and log it for the in-app log panel.
      localStorage.removeItem(localStorageKey);
      addLogEntry(
        `Discarded an unusable stored value for '${localStorageKey}'`,
      );
    }
  }
  const localStoragePubSub = createPubSub(initialValue);

  const [, onValueChange] = localStoragePubSub;

  onValueChange((value) =>
    localStorage.setItem(localStorageKey, JSON.stringify(value)),
  );

  return localStoragePubSub;
}

const querySuggestionsPubSub = createLocalStoragePubSub<string[]>(
  "querySuggestions",
  [],
);

const lastSearchTokenHashPubSub = createLocalStoragePubSub(
  "lastSearchTokenHash",
  "",
);

export const [updateLastSearchTokenHash, , getLastSearchTokenHash] =
  lastSearchTokenHashPubSub;

export const [updateQuerySuggestions, , getQuerySuggestions] =
  querySuggestionsPubSub;

export const queryPubSub = createPubSub(
  new URLSearchParams(self.location.search).get("q") ?? "",
);

export const [, , getQuery] = queryPubSub;

export const responsePubSub = createPubSub("");

export const updateResponse = throttle(responsePubSub[0], 1000 / 12);
export const [, , getResponse] = responsePubSub;

export const [updateSearchPromise, , getSearchPromise] = createPubSub<
  Promise<SearchResults>
>(Promise.resolve({ textResults: [], imageResults: [] }));

export const textGenerationStatePubSub =
  createPubSub<TextGenerationState>("idle");

export const [updateTextGenerationState, , getTextGenerationState] =
  textGenerationStatePubSub;

const [, listenToTextGenerationStateChanges] = textGenerationStatePubSub;

listenToTextGenerationStateChanges((textGenerationState) => {
  addLogEntry(`Text generation state changed to '${textGenerationState}'`);
});

export const modelLoadingProgressPubSub = createPubSub(0);

export const [updateModelLoadingProgress] = modelLoadingProgressPubSub;

export const settingsPubSub = createLocalStoragePubSub(
  SETTINGS_STORAGE_KEY,
  defaultSettings,
);

export const [, listenToSettingsChanges, getSettings] = settingsPubSub;

export const modelSizeInMegabytesPubSub = createPubSub(0);

export const [updateModelSizeInMegabytes] = modelSizeInMegabytesPubSub;

export const textSearchStatePubSub = createPubSub<SearchState>("idle");
export const imageSearchStatePubSub = createPubSub<SearchState>("idle");

export const [updateTextSearchState] = textSearchStatePubSub;

const [, subscribeToTextSearchState] = textSearchStatePubSub;

subscribeToTextSearchState((textSearchState) => {
  addLogEntry(`Text search state changed to '${textSearchState}'`);
});

export const [updateImageSearchState] = imageSearchStatePubSub;

const [, subscribeToImageSearchState] = imageSearchStatePubSub;

subscribeToImageSearchState((imageSearchState) => {
  addLogEntry(`Image search state changed to '${imageSearchState}'`);
});

export const textSearchResultsPubSub = createPubSub<TextSearchResults>([]);

const llmTextSearchResultsPubSub = createPubSub<TextSearchResults>([]);

export const imageSearchResultsPubSub = createPubSub<ImageSearchResults>([]);

export const [updateTextSearchResults] = textSearchResultsPubSub;

export const [updateLlmTextSearchResults, , getLlmTextSearchResults] =
  llmTextSearchResultsPubSub;

export const [updateImageSearchResults] = imageSearchResultsPubSub;

const pageContentsPubSub = createPubSub<PageContents>({});

export const [updatePageContents, , getPageContents] = pageContentsPubSub;

export const menuExpandedAccordionsPubSub = createLocalStoragePubSub<string[]>(
  "menuExpandedAccordions",
  [],
);

/**
 * Whether the menu's dismissible feature-tips hint is still visible. Kept in
 * its own channel rather than `settings` because the settings forms snapshot
 * `settings` at mount and write the whole object back, which would resurrect
 * a dismissed flag.
 */
export const showFeatureTipsPubSub = createLocalStoragePubSub(
  "showFeatureTips",
  true,
);

export const chatInputPubSub = createPubSub("");

export const [updateChatInput] = chatInputPubSub;

export const chatGenerationStatePubSub = createPubSub({
  isGeneratingResponse: false,
  isGeneratingFollowUpQuestion: false,
});

export const followUpQuestionPubSub = createPubSub("");

export const [updateFollowUpQuestion] = followUpQuestionPubSub;

const conversationSummaryPubSub = createPubSub({
  conversationId: "",
  summary: "",
});

export const [updateConversationSummary, , getConversationSummary] =
  conversationSummaryPubSub;

export const chatMessagesPubSub = createPubSub<
  Array<{ role: "user" | "assistant"; content: string }>
>([]);

export const [updateChatMessages] = chatMessagesPubSub;

export const isRestoringFromHistoryPubSub = createPubSub(false);

export const [updateIsRestoringFromHistory] = isRestoringFromHistoryPubSub;

export const suppressNextFollowUpPubSub = createPubSub(false);

export const [updateSuppressNextFollowUp, , getSuppressNextFollowUp] =
  suppressNextFollowUpPubSub;
