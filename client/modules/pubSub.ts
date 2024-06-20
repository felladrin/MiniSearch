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

export const useLargerModelSettingPubSub = createLocalStoragePubSub(
  "useLargerModel",
  false,
);

export const [, , getUseLargerModelSetting] = useLargerModelSettingPubSub;

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
  5,
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

export const [updateQuery, , getQuery] = queryPubSub;

export const responsePubSub = createPubSub("");

export const [updateResponse] = responsePubSub;

export const searchResultsPubSub = createPubSub<SearchResults>([]);

export const [updateSearchResults, , getSearchResults] = searchResultsPubSub;

export const urlsDescriptionsPubSub = createPubSub<Record<string, string>>({});

export const [updateUrlsDescriptions] = urlsDescriptionsPubSub;

export const debugModeEnabledPubSub = createPubSub(
  new URLSearchParams(self.location.search).has("debug"),
);

export const [, , isDebugModeEnabled] = debugModeEnabledPubSub;

export const interruptTextGenerationPubSub = createPubSub();

export const [interruptTextGeneration, onTextGenerationInterrupted] =
  interruptTextGenerationPubSub;
