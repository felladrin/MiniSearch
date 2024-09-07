import { createPubSub } from "create-pubsub";
import { SearchResults } from "./search";
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

export const querySuggestionsPubSub = createLocalStoragePubSub<string[]>(
  "querySuggestions",
  [],
);

export const lastSearchTokenHashPubSub = createLocalStoragePubSub(
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

export const [updateResponse] = responsePubSub;

export const searchResultsPubSub = createPubSub<SearchResults>({
  textResults: [],
  imageResults: [],
});

export const [updateSearchResults, , getSearchResults] = searchResultsPubSub;

export const [updateSearchPromise, , getSearchPromise] = createPubSub<
  Promise<SearchResults>
>(Promise.resolve({ textResults: [], imageResults: [] }));

export const textGenerationStatePubSub = createPubSub<
  | "idle"
  | "loadingModel"
  | "awaitingSearchResults"
  | "preparingToGenerate"
  | "generating"
  | "interrupted"
  | "failed"
  | "completed"
>("idle");

export const [updateTextGenerationState, , getTextGenerationState] =
  textGenerationStatePubSub;

export const searchStatePubSub = createPubSub<
  "idle" | "running" | "failed" | "completed"
>("idle");

export const [updateSearchState] = searchStatePubSub;

export const modelLoadingProgressPubSub = createPubSub(0);

export const [updateModelLoadingProgress] = modelLoadingProgressPubSub;

export const settingsPubSub = createLocalStoragePubSub(
  "settings",
  defaultSettings,
);

export const [updateSettings, onSettingsChange, getSettings] = settingsPubSub;
