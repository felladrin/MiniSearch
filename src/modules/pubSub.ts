import { createPubSub } from "create-pubsub";
import { SearchResults } from "./search";

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

export const summarizeLinksSettingPubSub = createLocalStoragePubSub(
  "summarizeLinks",
  false,
);
export const [, , getSummarizeLinksSetting] = summarizeLinksSettingPubSub;

export const useLargerModelSettingPubSub = createLocalStoragePubSub(
  "useLargerModel",
  false,
);
export const [, , getUseLargerModelSetting] = useLargerModelSettingPubSub;

export const promptPubSub = createPubSub("Analyzing query...");
export const [updatePrompt] = promptPubSub;
export const responsePubSub = createPubSub("Loading...");
export const [updateResponse] = responsePubSub;
export const searchResultsPubSub = createPubSub<SearchResults>([]);
export const [updateSearchResults, , getSearchResults] = searchResultsPubSub;
export const urlsDescriptionsPubSub = createPubSub<Record<string, string>>({});
export const [updateUrlsDescriptions, , getUrlsDescriptions] =
  urlsDescriptionsPubSub;
