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
  "settings",
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

export const [updateTextSearchResults, , getTextSearchResults] =
  textSearchResultsPubSub;

export const [updateLlmTextSearchResults, , getLlmTextSearchResults] =
  llmTextSearchResultsPubSub;

export const [updateImageSearchResults, , getImageSearchResults] =
  imageSearchResultsPubSub;

export const menuExpandedAccordionsPubSub = createLocalStoragePubSub<string[]>(
  "menuExpandedAccordions",
  [],
);

export const chatInputPubSub = createPubSub("");

export const chatGenerationStatePubSub = createPubSub({
  isGeneratingResponse: false,
  isGeneratingFollowUpQuestion: false,
});

export const followUpQuestionPubSub = createPubSub("");
