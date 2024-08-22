import { createPubSub } from "create-pubsub";
import { SearchResults } from "./search";
import { isRunningOnMobile } from "./mobileDetection";

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

export const disableAiResponseSettingPubSub = createLocalStoragePubSub(
  "disableAiResponse",
  false,
);

export const [, , getDisableAiResponseSetting] = disableAiResponseSettingPubSub;

export const disableWebGpuUsageSettingPubSub = createLocalStoragePubSub(
  "disableWebGpuUsage",
  false,
);

export const [, , getDisableWebGpuUsageSetting] =
  disableWebGpuUsageSettingPubSub;

export const numberOfThreadsSettingPubSub = createLocalStoragePubSub(
  "numberOfThreads",
  !isRunningOnMobile && (navigator.hardwareConcurrency ?? 1) > 1
    ? Math.max(navigator.hardwareConcurrency - 2, 2)
    : 1,
);

export const [, , getNumberOfThreadsSetting] = numberOfThreadsSettingPubSub;

export const searchResultsToConsiderSettingPubSub = createLocalStoragePubSub(
  "searchResultsToConsider",
  isRunningOnMobile ? 3 : 6,
);

export const [, , getNumberOfSearchResultsToConsiderSetting] =
  searchResultsToConsiderSettingPubSub;

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

export const searchResultsPubSub = createPubSub<SearchResults>([]);

export const [updateSearchResults, , getSearchResults] = searchResultsPubSub;

export const urlsDescriptionsPubSub = createPubSub<Record<string, string>>({});

export const [updateUrlsDescriptions] = urlsDescriptionsPubSub;

export const interruptTextGenerationPubSub = createPubSub();

export const [interruptTextGeneration, onTextGenerationInterrupted] =
  interruptTextGenerationPubSub;

export const [updateSearchPromise, , getSearchPromise] = createPubSub<
  Promise<SearchResults>
>(Promise.resolve([]));

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
