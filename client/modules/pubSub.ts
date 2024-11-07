import { createPubSub } from "create-pubsub";
import throttle from "throttleit";
import { addLogEntry } from "./logEntries";
import { defaultSettings } from "./settings";

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

export const searchResultsPubSub = createPubSub<
  import("./search").SearchResults
>({
  textResults: [],
  imageResults: [],
});

export const [updateSearchResults, , getSearchResults] = searchResultsPubSub;

export const [updateSearchPromise, , getSearchPromise] = createPubSub<
  Promise<import("./search").SearchResults>
>(Promise.resolve({ textResults: [], imageResults: [] }));

export const textGenerationStatePubSub = createPubSub<
  | "idle"
  | "awaitingModelDownloadAllowance"
  | "loadingModel"
  | "awaitingSearchResults"
  | "preparingToGenerate"
  | "generating"
  | "interrupted"
  | "failed"
  | "completed"
>("idle");

export const [
  updateTextGenerationState,
  listenToTextGenerationStateChanges,
  getTextGenerationState,
] = textGenerationStatePubSub;

listenToTextGenerationStateChanges((textGenerationState) => {
  addLogEntry(`Text generation state changed to '${textGenerationState}'`);
});

export const searchStatePubSub = createPubSub<
  "idle" | "running" | "failed" | "completed"
>("idle");

export const [updateSearchState, listenToSearchStateChanges] =
  searchStatePubSub;

listenToSearchStateChanges((searchState) => {
  addLogEntry(`Search state changed to '${searchState}'`);
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
