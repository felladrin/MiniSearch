import { createPubSub } from "create-pubsub";
import { addLogEntry } from "./logEntries";
import * as safeStorage from "./safeStorage";
import {
  coerceNumericSettings,
  defaultSettings,
  SETTINGS_STORAGE_KEY,
} from "./settings";
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

/**
 * Fill a stored settings object with the defaults for the keys it does not
 * have, so the first value a reader sees is complete even when the stored
 * profile predates a newly added key. A stored key whose value has a
 * different JSON kind than the default falls back to the default alone; keys
 * the defaults do not know are kept.
 */
function hydrateWithDefaults<T>(defaultValue: T, parsed: unknown): T {
  if (
    typeof defaultValue !== "object" ||
    defaultValue === null ||
    Array.isArray(defaultValue) ||
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return parsed as T;
  }
  const defaults = defaultValue as Record<string, unknown>;
  const accepted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!(key in defaults) || isSameJsonKind(value, defaults[key])) {
      accepted[key] = value;
    }
  }
  return { ...defaults, ...accepted } as T;
}

function createLocalStoragePubSub<T>(
  localStorageKey: string,
  defaultValue: T,
  normalize?: (value: T) => T,
  reportUsableStoredValue?: (usable: boolean) => void,
) {
  const localStorageValue = safeStorage.getItem(localStorageKey);
  let initialValue: T = defaultValue;
  if (localStorageValue !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(localStorageValue);
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined && isSameJsonKind(parsed, defaultValue)) {
      const hydrated = hydrateWithDefaults(defaultValue, parsed);
      initialValue = normalize ? normalize(hydrated) : hydrated;
      reportUsableStoredValue?.(true);
    } else {
      // Runs at module load, so an unparseable or wrong-type stored value must
      // not crash the app. Remove it (so the fallback doesn't repeat on every
      // load) and log it for the in-app log panel.
      safeStorage.removeItem(localStorageKey);
      addLogEntry(
        `Discarded an unusable stored value for '${localStorageKey}'`,
      );
      reportUsableStoredValue?.(false);
    }
  }
  const localStoragePubSub = createPubSub(initialValue);

  const [updateValue, onValueChange, getValue] = localStoragePubSub;

  onValueChange((value) =>
    safeStorage.setItem(localStorageKey, JSON.stringify(value)),
  );

  if (!normalize) return localStoragePubSub;
  // Every write goes through the same rule as hydration, so no path can store
  // a value the consumers would misread.
  return [
    (value: T) => updateValue(normalize(value)),
    onValueChange,
    getValue,
  ] as typeof localStoragePubSub;
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

const responseThrottleInterval = 1000 / 12;

/**
 * Throttles a publisher to one leading write plus at most one trailing write
 * per interval, keeping the newest value. `publishNow` drops the trailing
 * write, so a caller that already holds the final value can publish it without
 * a queued stale write landing afterwards.
 */
function createThrottledPublisher<T>(
  publish: (value: T) => void,
  interval: number,
) {
  let lastPublishTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let pendingValue: T | undefined;
  let hasPendingValue = false;

  const cancelPending = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    timeoutId = undefined;
    pendingValue = undefined;
    hasPendingValue = false;
  };

  const throttled = (value: T) => {
    const now = Date.now();
    const timeSinceLastPublish = now - lastPublishTime;

    cancelPending();

    if (timeSinceLastPublish >= interval) {
      lastPublishTime = now;
      publish(value);
      return;
    }

    pendingValue = value;
    hasPendingValue = true;
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      if (!hasPendingValue) return;
      const pending = pendingValue as T;
      pendingValue = undefined;
      hasPendingValue = false;
      lastPublishTime = Date.now();
      publish(pending);
    }, interval - timeSinceLastPublish);
  };

  throttled.publishNow = (value: T) => {
    cancelPending();
    lastPublishTime = Date.now();
    publish(value);
  };

  return throttled;
}

export const updateResponse = createThrottledPublisher(
  responsePubSub[0],
  responseThrottleInterval,
);

/**
 * Publishes the final response without waiting for the throttle window and
 * drops a trailing write still queued, so the UI and the chat mount read the
 * complete answer instead of the last value that happened to be published.
 */
export const updateResponseImmediately = updateResponse.publishNow;

export const [, , getResponse] = responsePubSub;

/**
 * The generation speed of the answer on screen, already worded for the card
 * (for example `42 tokens/s`). Nothing is published while an answer is still
 * generating, and a backend that reports no exact token count publishes
 * nothing, so a rate only ever appears once it is known for that answer.
 */
export const generationRatePubSub = createPubSub<string | undefined>(undefined);

export const [updateGenerationRate] = generationRatePubSub;

export const [updateSearchPromise, , getSearchPromise] = createPubSub<
  Promise<SearchResults>
>(Promise.resolve({ textResults: [], imageResults: [] }));

export const textGenerationStatePubSub =
  createPubSub<TextGenerationState>("idle");

export const [updateTextGenerationState, , getTextGenerationState] =
  textGenerationStatePubSub;

export const [, listenToTextGenerationStateChanges] = textGenerationStatePubSub;

listenToTextGenerationStateChanges((textGenerationState) => {
  addLogEntry(`Text generation state changed to '${textGenerationState}'`);
});

export type TextToSpeechState = "idle" | "speaking";

export const textToSpeechStatePubSub = createPubSub<TextToSpeechState>("idle");

export const [updateTextToSpeechState] = textToSpeechStatePubSub;

export const modelLoadingProgressPubSub = createPubSub(0);

export const [updateModelLoadingProgress] = modelLoadingProgressPubSub;

let storedSettingsUsable = false;

export const settingsPubSub = createLocalStoragePubSub(
  SETTINGS_STORAGE_KEY,
  defaultSettings,
  coerceNumericSettings,
  (usable) => {
    storedSettingsUsable = usable;
  },
);

/**
 * Whether this browser already had a usable settings object from an earlier
 * visit, decided while `settingsPubSub` hydrated. `applyServerConfig()` uses
 * it to tell an untouched profile from a user who deliberately picked a value
 * that happens to equal a default. A stored value that was discarded as
 * unusable counts as no stored settings, which is what the merge assumes.
 */
export const hasStoredUserSettings = storedSettingsUsable;

export const [updateSettings, listenToSettingsChanges, getSettings] =
  settingsPubSub;

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

export const [updateImageSearchResults, , getImageSearchResults] =
  imageSearchResultsPubSub;

export const textSearchStalePubSub = createPubSub<boolean>(false);

export const [updateTextSearchStale, , getTextSearchStale] =
  textSearchStalePubSub;

/**
 * Whether the text results on screen carry no time filter although one was
 * asked for, which is a fallback provider having answered the search.
 */
export const textSearchTimeFilterPubSub = createPubSub<boolean>(false);

export const [
  updateTextSearchTimeFilterNotApplied,
  ,
  getTextSearchTimeFilterNotApplied,
] = textSearchTimeFilterPubSub;

/**
 * Whether the text results on screen came back in no particular language
 * although one was asked for, which is the same fallback having answered.
 */
export const textSearchLanguagePubSub = createPubSub<boolean>(false);

export const [
  updateTextSearchLanguageNotApplied,
  ,
  getTextSearchLanguageNotApplied,
] = textSearchLanguagePubSub;

const pageContentsPubSub = createPubSub<PageContents>({});

export const [updatePageContents, , getPageContents] = pageContentsPubSub;

export const menuExpandedAccordionsPubSub = createLocalStoragePubSub<string[]>(
  "menuExpandedAccordions",
  [],
);

export const chatInputPubSub = createPubSub("");

export const [updateChatInput, , getChatInput] = chatInputPubSub;

export const chatGenerationStatePubSub = createPubSub({
  isGeneratingResponse: false,
  isGeneratingFollowUpQuestion: false,
});

export const [, , getChatGenerationState] = chatGenerationStatePubSub;

export const followUpQuestionPubSub = createPubSub("");

export const [updateFollowUpQuestion, , getFollowUpQuestion] =
  followUpQuestionPubSub;

const conversationSummaryPubSub = createPubSub<{
  conversationId: string;
  summary: string;
  /** How many of the conversation's first messages the summary covers. */
  summarizedCount?: number;
  /** Identifies the covered messages, to notice a rewritten history. */
  lastSummarizedFingerprint?: string;
}>({
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

/**
 * Changes when a history restore switches to another search, so the chat is
 * mounted again for it. The old chat's unmount aborts its follow-up and drops
 * its pending suggestion, which would otherwise land in the restored chat.
 */
export const chatSessionPubSub = createPubSub(0);

export const [updateChatSession, , getChatSession] = chatSessionPubSub;

export const suppressNextFollowUpPubSub = createPubSub(false);

export const [updateSuppressNextFollowUp, , getSuppressNextFollowUp] =
  suppressNextFollowUpPubSub;
